FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install -r requirements.txt && useradd -m -u 10001 app
COPY backend/ .
RUN chmod 755 /app/entrypoint.sh && rm -f .env && chown -R app /app
USER app
EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]
