import os
import base64
from cryptography.fernet import Fernet


def _get_fernet() -> Fernet:
    key = os.environ.get('AI_CONFIG_ENCRYPTION_KEY')
    if not key:
        raise RuntimeError(
            'AI_CONFIG_ENCRYPTION_KEY environment variable is not set. '
            'Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
        )
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_api_key(plaintext: str) -> str:
    if not plaintext:
        return ''
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_api_key(ciphertext: str) -> str:
    if not ciphertext:
        return ''
    return _get_fernet().decrypt(ciphertext.encode()).decode()