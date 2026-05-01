import os
from flask import Flask
from app.extensions import db, migrate, login_manager, cors
from config import config


def create_app(config_name: str = None) -> Flask:
    app = Flask(__name__)

    config_name = config_name or os.environ.get('FLASK_ENV', 'default')
    app.config.from_object(config[config_name])

    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)

    # CORS — allow the Vite dev server to make credentialed requests
    cors.init_app(app, resources={
        r'/api/*': {
            'origins': app.config.get('CORS_ORIGINS', ['http://localhost:5173']),
            'supports_credentials': True,
            'allow_headers': ['Content-Type', 'X-Requested-With'],
            'methods': ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        }
    })

    login_manager.login_view = 'v1.login'

    with app.app_context():
        from app.models import User

        @login_manager.user_loader
        def load_user(user_id):
            return User.query.get(int(user_id))

        from app.api.v1 import bp as api_v1_bp
        app.register_blueprint(api_v1_bp, url_prefix='/api/v1')

        from app.cli import register_commands
        from app.visual_arkiv_import import register_visual_arkiv_import
        register_commands(app)
        register_visual_arkiv_import(app)

        # Serve React SPA in production
        frontend_dist = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'dist')
        if os.path.isdir(frontend_dist):
            from flask import send_from_directory

            @app.route('/', defaults={'path': ''})
            @app.route('/<path:path>')
            def serve_spa(path):
                if path.startswith('api/'):
                    from flask import abort
                    abort(404)
                full = os.path.join(frontend_dist, path)
                if path and os.path.exists(full):
                    return send_from_directory(frontend_dist, path)
                return send_from_directory(frontend_dist, 'index.html')

    return app