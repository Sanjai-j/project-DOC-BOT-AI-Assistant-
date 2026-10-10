import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * The unified login page now covers patient and doctor flows.
 * Kept as a redirect target for older links (e.g. from the landing footer).
 */
export default function DoctorLogin() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/login', { replace: true });
  }, [navigate]);
  return null;
}
