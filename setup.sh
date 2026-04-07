#!/bin/bash
set -e

echo "========================================="
echo "  Local LLM ChatBot Setup"
echo "========================================="

# 0. 토큰 확인
if grep -q "여기에_authtoken_붙여넣기" .env 2>/dev/null; then
  echo ""
  echo "[!] .env 파일에 ngrok 설정이 되지 않았습니다."
  echo "    ngrok 없이 로컬 전용으로 시작합니다."
  echo "    외부 접속이 필요하면 .env를 수정 후 docker compose up -d 하세요."
  echo ""
  SKIP_NGROK=true
fi

# 1. Docker Compose 실행
echo "[1/3] Docker 컨테이너 시작 중..."
if [ "$SKIP_NGROK" = true ]; then
  docker compose up -d ollama open-webui
else
  docker compose up -d
fi

# 2. Ollama 준비 대기
echo ""
echo "[2/3] Ollama 서버 준비 대기 중..."
until docker exec ollama ollama list >/dev/null 2>&1; do
  sleep 2
done
echo "Ollama 준비 완료!"

# 3. 모델 다운로드
echo ""
echo "[3/3] 모델 다운로드 중 (시간이 걸릴 수 있습니다)..."

echo ""
echo ">>> Qwen3 14B (고품질, 범용) 다운로드 중..."
docker exec ollama ollama pull qwen3:14b

echo ""
echo ">>> Qwen3 4B (빠른 응답) 다운로드 중..."
docker exec ollama ollama pull qwen3:4b

echo ""
echo ">>> Gemma3 12B (Google, 코딩/영어 강함) 다운로드 중..."
docker exec ollama ollama pull gemma3:12b

echo ""
echo ">>> DeepSeek-R1 14B (추론/수학 특화) 다운로드 중..."
docker exec ollama ollama pull deepseek-r1:14b

echo ""
echo "========================================="
echo "  설치 완료!"
echo "========================================="
echo ""
echo "  로컬 접속:   http://localhost:3000"
if [ "$SKIP_NGROK" != true ]; then
  DOMAIN=$(grep NGROK_DOMAIN .env | grep -v "^#" | cut -d= -f2)
  echo "  외부 접속:   https://${DOMAIN}"
fi
echo ""
echo "  첫 가입 사용자가 관리자가 됩니다"
echo ""
echo "  모델 추가:   docker exec ollama ollama pull <모델명>"
echo "  종료:        docker compose down"
echo "  재시작:      docker compose up -d"
echo "========================================="
