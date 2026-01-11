import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useParams,
  useNavigate,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import type { JSX } from "react/jsx-dev-runtime";

// Utils de roles (unificados) 
import { ROLES as ROL, rolId, homeByRole } from "./utils/roles";

// Públicas */
import Login from "./pages/login";
import RegistroPaciente from "./pages/registroPaciente";
import ForgotPassword from "./pages/forgotPassword";
import ResetPassword from "./pages/resetPassword";
import RoleSelector from "./pages/RoleSelector";

// Admin: Layout + Pages
import AdminLayout from "./layouts/AdminLayout";
import Inicio from "./pages/admin/Inicio";
import Odontologos from "./pages/admin/Odontologos";
import OdontologosNuevo from "./pages/admin/OdontologosNuevo";
import OdontologoDetalle from "./pages/admin/OdontologoDetalle";
import OdontologoEdicion from "./pages/admin/OdontologoEdicion";
import Pacientes from "./pages/admin/Pacientes";
import PacientesNuevo from "./pages/admin/PacientesNuevo";
import PacienteDetalle from "./pages/admin/PacienteDetalle";
import PacienteEdicion from "./pages/admin/PacienteEdicion";
import Agenda from "./pages/admin/Agenda";
import AgendarCitaAdmin from "./pages/admin/AgendarCita";
import CitaEditar from "./pages/admin/CitaEditar";
import CitaDetalles from "./pages/admin/CitaDetalles";
import RegistroPago from "./pages/admin/RegistroPago";
import EditarPago from "./pages/admin/EditarPago";
import Reportes from "./pages/admin/Reportes";
import Perfil from "./pages/admin/Perfil";
import PerfilEdicion from "./pages/admin/PerfilEdicion";
import Configuracion from "./pages/admin/Configuracion";
import BloqueosAgenda from "./pages/admin/BloqueosAgenda";
import AdminGestion from "./pages/admin/AdminGestion";
import AdminNuevo from "./pages/admin/AdminNuevo";
import AdminPerfil from "./pages/admin/AdminPerfil";
import AdminEdicion from "./pages/admin/AdminEdicion";
import AgregarDatosPaciente from "./pages/admin/AgregarDatosPaciente";

// Paciente: Layout + Pages
import PacienteLayout from "./layouts/PacienteLayout";
import PacienteInicio from "./pages/paciente/Inicio";
import PacienteAgendarCita from "./pages/paciente/AgendarCitas";
import GestionarCitas from "./pages/paciente/GestionarCitas";
import Historial from "./pages/paciente/Historial";
import Servicios from "./pages/paciente/Servicios";
import PerfilPaciente from "./pages/paciente/Perfil";
import PerfilEditar from "./pages/paciente/PerfilEditar";
import CitasReprogramar from "./pages/paciente/CitasReprogramar";
import PacienteVerCita from "./pages/paciente/VerCita";

// Odontólogo: Layout + Pages
import OdontologoLayout from "./layouts/OdontologoLayout";
import OdoInicio from "./pages/odontologo/Inicio";
import OdoAgenda from "./pages/odontologo/Agenda";
import OdoPacientes from "./pages/odontologo/Pacientes";
import OdoEstadisticas from "./pages/odontologo/Estadisticas";
import OdoPerfil from "./pages/odontologo/Perfil";
import OdoPerfilEdicion from "./pages/odontologo/PerfilEdicion";
import OdoVerPaciente from "./pages/odontologo/VerPaciente";
import OdoPacienteEdicion from "./pages/odontologo/EditarPaciente";
import OdoAgregarPaciente from "./pages/odontologo/AgregarPaciente";
import OdoVerCita from "./pages/odontologo/VerCita";
import OdoCitaEditar from "./pages/odontologo/EditarCita";
import OdoAtencionCita from "./pages/odontologo/AtencionCita";
import OdoAgendarCita from "./pages/odontologo/AgendarCita";
import OdoRegistroPago from "./pages/odontologo/RegistroPago";
import OdoEditarPago from "./pages/odontologo/EditarPago";

// Guard por rol
function ProtectedRoute({
  allowed,
  children,
}: {
  allowed: number[];
  children: JSX.Element;
}) {
  const { usuario } = useAuth();

  if (!usuario) return <Navigate to="/login" replace />;

  // Superusuario entra siempre
  if ((usuario as any).is_superuser) return children;

  const idRol = rolId((usuario as any).id_rol);
  
  // Verificar si tiene acceso por rol principal
  const tieneAccesoPorRolPrincipal = idRol != null && allowed.includes(idRol);
  
  // Verificar si tiene acceso por contexto activo (roles adicionales)
  const contextoActivo = localStorage.getItem("contexto_activo");
  let tieneAccesoPorContexto = false;
  
  if (contextoActivo === "paciente" && allowed.includes(ROL.PACIENTE)) {
    // Verificar que realmente tenga datos de paciente
    const idPaciente = localStorage.getItem("id_paciente");
    tieneAccesoPorContexto = !!idPaciente;
  } else if (contextoActivo === "odontologo" && allowed.includes(ROL.ODONTOLOGO)) {
    // Verificar que realmente tenga datos de odontólogo Y que esté activo
    const idOdontologo = localStorage.getItem("id_odontologo");
    const odontologoActivo = localStorage.getItem("odontologo_activo");
    // Solo tiene acceso si existe id_odontologo y está activo (o no especificado, por retrocompatibilidad)
    tieneAccesoPorContexto = !!idOdontologo && (odontologoActivo === null || odontologoActivo === "true");
  }
  
  return tieneAccesoPorRolPrincipal || tieneAccesoPorContexto ? (
    children
  ) : (
    <Navigate to={homeByRole(idRol, (usuario as any).is_superuser)} replace />
  );
}

// Redirección para rutas inexistentes
function NotFoundRedirect() {
  const { usuario } = useAuth();
  if (!usuario) return <Navigate to="/login" replace />;
  const idRol = rolId((usuario as any).id_rol);
  return (
    <Navigate to={homeByRole(idRol, (usuario as any).is_superuser)} replace />
  );
}

// Wrapper de página para CitasReprogramar (toma :citaId de la URL)
function PacienteCitasReprogramarWrapper() {
  const { citaId } = useParams<{ citaId: string }>();
  const navigate = useNavigate();

  const id = Number(citaId);
  if (!id || Number.isNaN(id)) {
    return <Navigate to="/paciente/mis-citas/gestionar" replace />;
  }

  return (
    <CitasReprogramar
      citaId={id}
      onCancel={() => navigate(-1)}
      onDone={() =>
        navigate("/paciente/mis-citas/gestionar", { replace: true })
      }
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* raíz redirige a /login */}
          <Route path="/" element={<Navigate to="/login" replace />} />

          {/* públicas */}
          <Route path="/login" element={<Login />} />
          <Route path="/registro-paciente" element={<RegistroPaciente />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          
          {/* Selección de rol (cuando usuario tiene múltiples roles) */}
          <Route path="/role-selector" element={<RoleSelector />} />

          {/* ADMIN (rutas privadas con layout persistente) */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowed={[ROL.ADMIN, ROL.ADMIN_CLINICO]}>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Inicio />} />
            <Route path="odontologos" element={<Odontologos />} />
            <Route path="odontologos/nuevo" element={<OdontologosNuevo />} />
            <Route path="odontologos/:id" element={<OdontologoDetalle />} />
            <Route
              path="odontologos/:id/editar"
              element={<OdontologoEdicion />}
            />

            <Route path="pacientes" element={<Pacientes />} />
            <Route path="pacientes/nuevo" element={<PacientesNuevo />} />
            <Route path="pacientes/:id" element={<PacienteDetalle />} />
            <Route path="pacientes/:id/editar" element={<PacienteEdicion />} />

            <Route path="agenda" element={<Agenda />} />
            <Route path="agenda/agendar" element={<AgendarCitaAdmin />} />

            <Route path="citas/:id/editar" element={<CitaEditar />} />
            <Route path="citas/:id" element={<CitaDetalles />} />
            <Route path="citas/:id/registrar-pago" element={<RegistroPago />} />
            <Route path="pagos/:id/editar" element={<EditarPago />} />

            <Route path="reportes" element={<Reportes />} />

            <Route path="perfil" element={<Perfil />} />
            <Route path="perfil/editar" element={<PerfilEdicion />} />

            <Route path="configuracion" element={<Configuracion />} />

            <Route path="bloqueos" element={<BloqueosAgenda />} />
            <Route path="administradores" element={<AdminGestion />} />
            <Route path="usuarios/nuevo" element={<AdminNuevo />} />
            <Route path="usuarios/:id" element={<AdminPerfil />} />
            <Route path="usuarios/:id/editar" element={<AdminEdicion />} />
            <Route path="usuarios/:userId/agregar-datos-paciente" element={<AgregarDatosPaciente />} />
          </Route>

          {/* PACIENTE (rutas privadas con layout persistente) */}
          <Route
            path="/paciente"
            element={
              <ProtectedRoute allowed={[ROL.PACIENTE]}>
                <PacienteLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<PacienteInicio />} />

            {/* Mis Citas */}
            <Route path="mis-citas">
              <Route index element={<Navigate to="agendar" replace />} />
              <Route path="agendar" element={<PacienteAgendarCita />} />
              <Route path="gestionar" element={<GestionarCitas />} />
              <Route path="historial" element={<Historial />} />
              <Route path="ver/:id" element={<PacienteVerCita />} />
              <Route
                path="reprogramar/:citaId"
                element={<PacienteCitasReprogramarWrapper />}
              />
            </Route>

            <Route path="servicios" element={<Servicios />} />
            <Route path="perfil" element={<PerfilPaciente />} />
            <Route path="perfil/editar" element={<PerfilEditar />} />
          </Route>

          {/* ODONTÓLOGO (rutas privadas con layout persistente) */}
          <Route
            path="/odontologo"
            element={
              <ProtectedRoute allowed={[ROL.ODONTOLOGO]}>
                <OdontologoLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<OdoInicio />} />
            <Route path="agenda" element={<OdoAgenda />} />
            <Route path="pacientes" element={<OdoPacientes />} />
            <Route path="estadisticas" element={<OdoEstadisticas />} />
            <Route path="perfil" element={<OdoPerfil />} />
            <Route path="perfil/editar" element={<OdoPerfilEdicion />} />
            <Route path="pacientes/:id" element={<OdoVerPaciente />} />
            <Route
              path="pacientes/:id/editar"
              element={<OdoPacienteEdicion />}
            />
            <Route path="pacientes/nuevo" element={<OdoAgregarPaciente />} />

            {/* Citas del odontólogo */}
            <Route path="citas/:id/ver" element={<OdoVerCita />} />
            <Route path="citas/agendar" element={<OdoAgendarCita />} />
            <Route path="citas/:id/editar" element={<OdoCitaEditar />} />
            <Route path="citas/:id/atencion" element={<OdoAtencionCita />} />
            
            {/* Pagos */}
            <Route path="citas/:id/registrar-pago" element={<OdoRegistroPago />} />
            <Route path="pagos/:id/editar" element={<OdoEditarPago />} />
          </Route>

          {/* wildcard */}
          <Route path="*" element={<NotFoundRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
