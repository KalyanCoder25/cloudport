FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 8090

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request as u, sys; sys.exit(0 if u.urlopen('http://127.0.0.1:8090/health', timeout=3).status == 200 else 1)"

# Single worker with a generous timeout: requests are short numeric computations,
# and a stable worker keeps results reproducible across calls.
CMD ["gunicorn", "--bind", "0.0.0.0:8090", "--workers", "1", "--timeout", "60", "app:app"]
