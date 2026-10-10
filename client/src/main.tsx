import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PatientLayout, DoctorLayout, AdminLayout, Spinner } from './components/ui';
import Landing from './pages/Landing';
import LoginPage from './pages/LoginPage';
import PatientLogin from './pages/PatientLogin';
import DoctorRegister from './pages/DoctorRegister';
import DoctorLogin from './pages/DoctorLogin';
import AdminLogin from './pages/AdminLogin';
import FindDoctors from './pages/FindDoctors';
import DoctorProfile from './pages/DoctorProfile';
import Hospitals from './pages/Hospitals';
import HowItWorks from './pages/HowItWorks';
import PatientDashboard from './pages/PatientDashboard';
import DocBotChat from './pages/DocBotChat';
import MyAppointments from './pages/MyAppointments';
import PatientVideo from './pages/PatientVideo';
import Notifications from './pages/Notifications';
import PatientProfile from './pages/PatientProfile';
import EmergencyPage from './pages/EmergencyPage';
import PatientEmergency from './pages/PatientEmergency';
import DoctorDashboard from './pages/DoctorDashboard';
import DoctorRequests from './pages/DoctorRequests';
import DoctorAppointments from './pages/DoctorAppointments';
import DoctorVideo from './pages/DoctorVideo';
import DoctorSchedule from './pages/DoctorSchedule';
import DoctorPatients from './pages/DoctorPatients';
import VideoRoom from './pages/VideoRoom';
import AdminDashboard from './pages/AdminDashboard';
import AdminVerification from './pages/AdminVerification';
import AdminDoctors from './pages/AdminDoctors';
import AdminPatients from './pages/AdminPatients';
import AdminHospitals from './pages/AdminHospitals';
import AdminAppointments from './pages/AdminAppointments';
import AdminEmergency from './pages/AdminEmergency';
import AdminSettings from './pages/AdminSettings';

function RequireRole({ role, children }: { role: string; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Checking your session…" />;
  if (!user) return <Navigate to={role === 'admin' ? '/admin/login' : '/login'} replace />;
  if (user.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<LoginPage />} />
          <Route path="/doctor/register" element={<DoctorRegister />} />
          <Route path="/doctor/login" element={<DoctorLogin />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/find-doctors" element={<FindDoctors />} />
          <Route path="/doctors/:id" element={<DoctorProfile />} />
          <Route path="/hospitals" element={<Hospitals />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/emergency" element={<EmergencyPage />} />

          {/* Patient */}
          <Route
            path="/patient"
            element={
              <RequireRole role="patient">
                <PatientLayout />
              </RequireRole>
            }
          >
            <Route index element={<PatientDashboard />} />
            <Route path="docbot" element={<DocBotChat />} />
            <Route path="find" element={<FindDoctors />} />
            <Route path="hospitals" element={<Hospitals />} />
            <Route path="appointments" element={<MyAppointments />} />
            <Route path="video" element={<PatientVideo />} />
            <Route path="video/:appointmentId" element={<VideoRoom />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="profile" element={<PatientProfile />} />
            <Route path="emergency" element={<PatientEmergency />} />
          </Route>

          {/* Doctor */}
          <Route
            path="/doctor"
            element={
              <RequireRole role="doctor">
                <DoctorLayout />
              </RequireRole>
            }
          >
            <Route index element={<DoctorDashboard />} />
            <Route path="requests" element={<DoctorRequests />} />
            <Route path="appointments" element={<DoctorAppointments />} />
            <Route path="video" element={<DoctorVideo />} />
            <Route path="video/:appointmentId" element={<VideoRoom />} />
            <Route path="schedule" element={<DoctorSchedule />} />
            <Route path="patients" element={<DoctorPatients />} />
            <Route path="notifications" element={<Notifications />} />
          </Route>

          {/* Admin */}
          <Route
            path="/admin"
            element={
              <RequireRole role="admin">
                <AdminLayout />
              </RequireRole>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="verification" element={<AdminVerification />} />
            <Route path="doctors" element={<AdminDoctors />} />
            <Route path="patients" element={<AdminPatients />} />
            <Route path="hospitals" element={<AdminHospitals />} />
            <Route path="appointments" element={<AdminAppointments />} />
            <Route path="emergency" element={<AdminEmergency />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
