import { Navigate } from "react-router-dom";

// The old signup flow asked for an account + POD code up front — the wrong
// order for Vatra (the consumer doesn't have those yet). It now redirects to
// the lead-capture landing (/join). Registration happens later, by email
// invite, only after a contract is signed.
export default function VatraSignup() {
  return <Navigate to="/join" replace />;
}
