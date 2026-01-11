// src/layouts/PacienteLayout.tsx
import React, { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  Menu,
  X,
  Home,
  CalendarDays,
  BookOpen,
  ChevronDown,
  ChevronRight,
  LogOut,
  User,
} from "lucide-react";
import logoUrl from "../assets/belladent-logo4.png";

function cx(...a: Array<string | false | null | undefined>) {
  return a.filter(Boolean).join(" ");
}

const PacienteLayout: React.FC = () => {
  const { setUsuario } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // Submenú "Mis Citas"
  const isInCitas = location.pathname.startsWith("/paciente/mis-citas");
  const [citasOpen, setCitasOpen] = useState<boolean>(isInCitas);

  // Marcar activo "Gestionar" también en /reprogramar/:id
  const isGestionarOrReprog = /\/paciente\/mis-citas\/(gestionar|reprogramar)(\/|$)/.test(
    location.pathname
  );

  useEffect(() => {
    setCitasOpen(isInCitas);
  }, [isInCitas]);

  const handleLogout = () => {
    try {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      localStorage.removeItem("usuario");
      localStorage.removeItem("tokenStore");
      sessionStorage.removeItem("accessToken");
      sessionStorage.removeItem("refreshToken");
      setUsuario(null);
      navigate("/login", { replace: true });
    } catch {
      setUsuario(null);
      navigate("/login", { replace: true });
    }
  };

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Topbar */}
      <header className="sticky top-0 z-40 bg-white shadow-sm">
        <div className="w-full px-1 sm:px-1 lg:px-1 xl:px-1 2xl:px-4">
          <div className="h-17 flex items-center justify-between">
            {/* Izquierda */}
            <div className="flex items-center gap-3">
              <button
                className="p-2 rounded-md border hover:bg-gray-50 lg:hidden"
                onClick={() => setSidebarOpen((v) => !v)}
                aria-label="Abrir/cerrar menú lateral"
              >
                {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
              </button>

              <img
                src={logoUrl}
                alt="Bella Dent"
                className="h-14 w-auto cursor-pointer"
                onClick={() => navigate("/paciente")}
              />
            </div>

            {/* Derecha */}
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full border px-3 py-1.5 hover:bg-gray-50"
                aria-haspopup="menu"
                aria-expanded={profileOpen}
              >
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-gray-200">
                  <User size={18} />
                </div>
                <ChevronDown size={18} />
              </button>

              {profileOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-56 rounded-xl border bg-white shadow-lg overflow-hidden"
                >
                  <div className="px-4 py-3 border-b">
                    <p className="text-sm text-gray-500">Sesión iniciada como</p>
                    <p className="text-sm font-medium">Paciente</p>
                  </div>
                  <ul className="py-1">
                    <li>
                      <button
                        className="w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-gray-50"
                        onClick={() => {
                          setProfileOpen(false);
                          navigate("/paciente/perfil");
                        }}
                      >
                        <User size={18} /> Perfil
                      </button>
                    </li>
                  </ul>
                  <div className="border-t">
                    <button
                      className="w-full px-4 py-2 text-left flex items-center gap-2 text-red-600 hover:bg-red-50"
                      onClick={handleLogout}
                    >
                      <LogOut size={18} /> Cerrar sesión
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Layout principal */}
      <div className="flex">
        <aside
          className={cx(
            "sticky top-16 h-[calc(100vh-4rem)] shrink-0",
            "bg-[#0070B7] shadow-lg",
            "transition-all duration-200 ease-in-out overflow-hidden",
            sidebarOpen ? "w-64 xl:w-72" : "w-0 lg:w-64 xl:w-72"
          )}
        >
          <nav
            className={cx(
              "h-full flex flex-col p-3",
              sidebarOpen ? "flex" : "hidden lg:flex"
            )}
          >
            <ul className="space-y-1 flex-1 overflow-y-auto pr-1">
              {/* Inicio */}
              <li>
                <NavLink
                  to="/paciente"
                  end
                  className={({ isActive }) =>
                    cx(
                      "flex items-center gap-3 rounded-lg px-6 py-5 text-lg font-medium text-white hover:bg-blue-600",
                      isActive && "bg-blue-700"
                    )
                  }
                >
                  <Home size={25} className="text-white" />
                  Inicio
                </NavLink>
              </li>

              {/* Mis Citas (con submenú) */}
              <li>
                <button
                  type="button"
                  onClick={() => setCitasOpen((v) => !v)}
                  aria-expanded={citasOpen}
                  className="w-full flex items-center justify-between rounded-lg px-6 py-5 text-lg font-medium text-white hover:bg-blue-600"
                >
                  <span className="flex items-center gap-3">
                    <CalendarDays size={25} className="text-white" />
                    Mis Citas
                  </span>
                  <ChevronDown
                    size={18}
                    className={cx(
                      "transition-transform",
                      citasOpen ? "rotate-180" : "rotate-0"
                    )}
                  />
                </button>

                {/* Submenú */}
                <ul
                  className={cx(
                    "mt-1 space-y-1 pl-6 pr-2",
                    citasOpen ? "block" : "hidden"
                  )}
                >
                  <li>
                    <NavLink
                      to="/paciente/mis-citas/agendar"
                      className={({ isActive }) =>
                        cx(
                          "flex items-center gap-2 rounded-md px-6 py-3 text-base text-white/95 hover:bg-blue-600",
                          isActive && "bg-blue-700 text-white"
                        )
                      }
                    >
                      <ChevronRight size={16} className="text-white/90" />
                      Agendar citas
                    </NavLink>
                  </li>
                  <li>
                    <NavLink
                      to="/paciente/mis-citas/gestionar"
                      className={({ isActive }) =>
                        cx(
                          "flex items-center gap-2 rounded-md px-6 py-3 text-base text-white/95 hover:bg-blue-600",
                          (isActive || isGestionarOrReprog) && "bg-blue-700 text-white"
                        )
                      }
                    >
                      <ChevronRight size={16} className="text-white/90" />
                      Gestionar citas
                    </NavLink>
                  </li>
                  <li>
                    <NavLink
                      to="/paciente/mis-citas/historial"
                      className={({ isActive }) =>
                        cx(
                          "flex items-center gap-2 rounded-md px-6 py-3 text-base text-white/95 hover:bg-blue-600",
                          isActive && "bg-blue-700 text-white"
                        )
                      }
                    >
                      <ChevronRight size={16} className="text-white/90" />
                      Historial
                    </NavLink>
                  </li>
                </ul>
              </li>

              {/* Servicios */}
              <li>
                <NavLink
                  to="/paciente/servicios"
                  className={({ isActive }) =>
                    cx(
                      "flex items-center gap-3 rounded-lg px-6 py-5 text-lg font-medium text-white hover:bg-blue-600",
                      isActive && "bg-blue-700"
                    )
                  }
                >
                  <BookOpen size={25} className="text-white" />
                  Servicios
                </NavLink>
              </li>
            </ul>

            <div className="pt-4 text-xs text-white/80">
              © {new Date().getFullYear()} OralFlow
            </div>
          </nav>
        </aside>

        <main className="flex-1">
          <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12 mt-4">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default PacienteLayout;
