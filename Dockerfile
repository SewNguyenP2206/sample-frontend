FROM python:3.12-slim

WORKDIR /app

COPY index.html styles.css app.js server.py package.json ./

ENV PORT=5173
EXPOSE 5173

CMD ["python3", "server.py"]