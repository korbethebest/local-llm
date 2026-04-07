from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime
import httpx
import json
import os

from models import User, Conversation, Message, get_db, init_db, SessionLocal
from auth import hash_password, verify_password, create_token, get_current_user_id

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434")
STATIC_DIR = os.getenv("STATIC_DIR", "/app/static")

app = FastAPI(docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


# ── Schemas ──

class RegisterBody(BaseModel):
    email: str
    username: str
    password: str


class LoginBody(BaseModel):
    email: str
    password: str


class ChatBody(BaseModel):
    conversation_id: Optional[int] = None
    content: str
    model: str


# ── Auth ──

@app.post("/auth/register")
def register(body: RegisterBody, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == body.email.lower().strip()).first():
        raise HTTPException(400, "이미 사용 중인 이메일입니다.")
    if len(body.password) < 6:
        raise HTTPException(400, "비밀번호는 6자 이상이어야 합니다.")
    if not body.username.strip():
        raise HTTPException(400, "이름을 입력해주세요.")
    user = User(
        email=body.email.lower().strip(),
        username=body.username.strip(),
        password_hash=hash_password(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"access_token": create_token(user.id), "username": user.username}


@app.post("/auth/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower().strip()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "이메일 또는 비밀번호가 올바르지 않습니다.")
    return {"access_token": create_token(user.id), "username": user.username}


@app.get("/auth/me")
def me(user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404)
    return {"id": user.id, "email": user.email, "username": user.username}


# ── Conversations ──

@app.get("/conversations")
def list_conversations(
    user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)
):
    convs = (
        db.query(Conversation)
        .filter(Conversation.user_id == user_id)
        .order_by(Conversation.updated_at.desc())
        .all()
    )
    return [
        {"id": c.id, "title": c.title, "model": c.model, "updated_at": c.updated_at.isoformat()}
        for c in convs
    ]


@app.get("/conversations/{conv_id}")
def get_conversation(
    conv_id: int,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    conv = (
        db.query(Conversation)
        .filter(Conversation.id == conv_id, Conversation.user_id == user_id)
        .first()
    )
    if not conv:
        raise HTTPException(404)
    return {
        "id": conv.id,
        "title": conv.title,
        "model": conv.model,
        "messages": [{"role": m.role, "content": m.content} for m in conv.messages],
    }


@app.delete("/conversations/{conv_id}")
def delete_conversation(
    conv_id: int,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    conv = (
        db.query(Conversation)
        .filter(Conversation.id == conv_id, Conversation.user_id == user_id)
        .first()
    )
    if not conv:
        raise HTTPException(404)
    db.delete(conv)
    db.commit()
    return {"ok": True}


# ── Ollama ──

@app.get("/ollama/tags")
async def ollama_tags(user_id: int = Depends(get_current_user_id)):
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            res = await client.get(f"{OLLAMA_URL}/api/tags")
            res.raise_for_status()
            return res.json()
        except Exception:
            raise HTTPException(503, "Ollama에 연결할 수 없습니다.")


# ── Chat stream ──

@app.post("/chat")
async def chat(
    body: ChatBody,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    # Get or create conversation
    if body.conversation_id:
        conv = (
            db.query(Conversation)
            .filter(Conversation.id == body.conversation_id, Conversation.user_id == user_id)
            .first()
        )
        if not conv:
            raise HTTPException(404)
    else:
        title = body.content[:50] + ("…" if len(body.content) > 50 else "")
        conv = Conversation(user_id=user_id, title=title, model=body.model)
        db.add(conv)
        db.commit()
        db.refresh(conv)

    # Save user message
    user_msg = Message(conversation_id=conv.id, role="user", content=body.content)
    db.add(user_msg)
    conv.model = body.model
    conv.updated_at = datetime.utcnow()
    db.commit()

    # Build full message history including new user message
    history = [
        {"role": m.role, "content": m.content}
        for m in db.query(Message)
        .filter(Message.conversation_id == conv.id)
        .order_by(Message.id)
        .all()
    ]
    conv_id = conv.id

    async def generate():
        accumulated = ""
        yield json.dumps({"conversation_id": conv_id}) + "\n"
        try:
            async with httpx.AsyncClient(timeout=300) as client:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_URL}/api/chat",
                    json={"model": body.model, "messages": history, "stream": True},
                ) as resp:
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            token = (data.get("message") or {}).get("content", "")
                            if token:
                                accumulated += token
                                yield json.dumps({"token": token}) + "\n"
                            if data.get("done"):
                                save_db = SessionLocal()
                                try:
                                    asst = Message(
                                        conversation_id=conv_id,
                                        role="assistant",
                                        content=accumulated,
                                    )
                                    save_db.add(asst)
                                    c = save_db.query(Conversation).filter(Conversation.id == conv_id).first()
                                    if c:
                                        c.updated_at = datetime.utcnow()
                                    save_db.commit()
                                finally:
                                    save_db.close()
                                yield json.dumps({"done": True}) + "\n"
                        except Exception:
                            pass
        except Exception as e:
            yield json.dumps({"error": str(e)}) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")


# ── Static files (must be last) ──
if os.path.isdir(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
