import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Doctor registration is now part of the unified login page (Doctor tab →
 * "Register for verification"). Kept as a redirect for older links.
 */
export default function DoctorRegister() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/login', { replace: true });
  }, [navigate]);
  return null;
}
