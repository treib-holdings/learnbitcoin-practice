# The practice network's bots. Standard library only: nothing to install.
FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b

RUN useradd --system --uid 1000 --no-create-home bots
WORKDIR /app
COPY practice_bots ./practice_bots

USER 1000:1000
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
CMD ["python", "-m", "practice_bots"]
