import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / '.env')


def _fix_postgres_url(url: str) -> str:
    if url and url.startswith('postgres://'):
        return url.replace('postgres://', 'postgresql://', 1)
    return url


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-change-in-production')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', str(BASE_DIR / 'uploads'))
    MAX_CONTENT_LENGTH = 50 * 1024 * 1024
    ALLOWED_UPLOAD_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'tiff', 'tif', 'txt', 'md', 'csv',
                                 'docx', 'xlsx', 'odt', 'ods', 'mp3', 'mp4', 'flac', 'wav', 'aiff','ogg'}

    # Session cookie — must allow cross-origin requests from Vite dev server
    SESSION_COOKIE_SAMESITE = 'None'
    SESSION_COOKIE_SECURE = False      # set True in production (requires HTTPS)
    SESSION_COOKIE_HTTPONLY = True
    CORS_ORIGINS = os.environ.get('CORS_ORIGINS', 'http://localhost:5173').split(',')


class DevelopmentConfig(Config):
    DEBUG = True
    SQLALCHEMY_DATABASE_URI = _fix_postgres_url(
        os.environ.get('DATABASE_URL',
                       f'sqlite:///{BASE_DIR / "kurbits_dev.db"}')
    )
    SQLALCHEMY_ECHO = False


class ProductionConfig(Config):
    DEBUG = False
    SESSION_COOKIE_SECURE = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    REMEMBER_COOKIE_SECURE = True
    REMEMBER_COOKIE_SAMESITE = 'Lax'
    REMEMBER_COOKIE_HTTPONLY = True
    SQLALCHEMY_DATABASE_URI = _fix_postgres_url(os.environ.get('DATABASE_URL'))
    CORS_ORIGINS = []


class TestingConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    SESSION_COOKIE_SAMESITE = 'Lax'


config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig,
}