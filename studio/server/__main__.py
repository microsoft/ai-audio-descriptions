import os

from .app import create_app


create_app().run(
    host=os.environ.get("HOST", "127.0.0.1"),
    port=int(os.environ.get("PORT", "3001")),
)
