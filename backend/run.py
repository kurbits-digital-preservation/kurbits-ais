import os
from app import create_app

app = create_app(os.environ.get('FLASK_ENV', 'development'))

if __name__ == '__main__':
    # TEMP
    ssl_context = (
            app.config["SSL_CERT"],
            app.config["SSL_KEY"],
        )
    app.run(port=8443,ssl_context=ssl_context)
