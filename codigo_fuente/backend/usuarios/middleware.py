# usuarios/middleware.py
from django.http import HttpResponse
from django.urls import resolve
from django.middleware.csrf import get_token

class SuperuserAdminMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Verificar si la URL pertenece al admin
        if request.path.startswith('/admin/'):
            # Permitir acceso a login y logout del admin
            if request.path in ['/admin/login/', '/admin/logout/'] or request.path.startswith('/admin/jsi18n/'):
                return self.get_response(request)
            
            # Verificar autenticación
            if request.user.is_authenticated:
                # Requerir AMBOS flags
                if not (request.user.is_staff and request.user.is_superuser):
                    html = f"""
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <title>Acceso Denegado</title>
                        <style>
                            body {{
                                font-family: Arial, sans-serif;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                height: 100vh;
                                margin: 0;
                                background-color: #f5f5f5;
                            }}
                            .container {{
                                text-align: center;
                                background: white;
                                padding: 40px;
                                border-radius: 8px;
                                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                            }}
                            h1 {{
                                color: #d32f2f;
                                margin-bottom: 20px;
                            }}
                            p {{
                                color: #666;
                                margin-bottom: 30px;
                            }}
                            .btn {{
                                display: inline-block;
                                padding: 12px 24px;
                                background-color: #1976d2;
                                color: white;
                                text-decoration: none;
                                border-radius: 4px;
                                font-weight: bold;
                                transition: background-color 0.3s;
                                border: none;
                                cursor: pointer;
                                font-size: 16px;
                            }}
                            .btn:hover {{
                                background-color: #1565c0;
                            }}
                            form {{
                                margin: 0;
                            }}
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h1>🚫 Acceso Denegado</h1>
                            <p>Se requieren permisos de <strong>superusuario</strong> para acceder al panel de administración.</p>
                            <p>Usuario actual: <strong>{request.user.cedula}</strong></p>
                            <form method="post" action="/admin/logout/">
                                <input type="hidden" name="csrfmiddlewaretoken" value="{get_token(request)}">
                                <button type="submit" class="btn">Cerrar Sesión e Ingresar con Otro Usuario</button>
                            </form>
                        </div>
                    </body>
                    </html>
                    """
                    return HttpResponse(html, status=403)
        
        return self.get_response(request)
