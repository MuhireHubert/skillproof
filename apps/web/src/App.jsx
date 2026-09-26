import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './Layout.jsx';
import { Empty, Loading } from './ui.jsx';
import AuthPage from './pages/Auth.jsx';
import { PublicProfile, VerifierSignoff } from './pages/Public.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { StudentProjects, StudentInternships, MyEvidence, EvidenceEditor, StudentAssessments, Journey, Profile } from './pages/student.jsx';
import { EmployerStandards, EmployerProjects, EmployerInternships, Review, Talent, Feedback } from './pages/employer.jsx';
import { InstitutionStandards, Demand, Gap, Programmes, Enrolments, Outcomes, Actions } from './pages/institution.jsx';
import { Requirements, Compliance } from './pages/regulator.jsx';
import Admin from './pages/Admin.jsx';
import AssessmentsManager from './pages/assessments.jsx';

function Protected() {
  const { session, profile, loading, signOut } = useAuth();
  if (loading) return <div className="p-10"><Loading /></div>;
  if (!session) return <Navigate to="/auth" replace />;
  if (!profile) {
    return (
      <div className="mx-auto max-w-xl p-10">
        <h2>Your profile is missing</h2>
        <p className="mt-2 text-ink-soft">Your account exists but has no profile yet. Sign out and sign up again, or ask an administrator.</p>
        <button type="button" className="btn mt-4" onClick={signOut}>Sign out</button>
      </div>
    );
  }
  return <Layout />;
}

// Same URL, different screen per role.
function ByRole(props) {
  const { role } = useAuth();
  return props[role] || <Empty>This section is not available for your account type.</Empty>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/p/:slug" element={<PublicProfile />} />
      <Route path="/v/:token" element={<VerifierSignoff />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route element={<Protected />}>
        <Route index element={<Dashboard />} />
        <Route path="projects" element={<ByRole student={<StudentProjects />} employer={<EmployerProjects />} />} />
        <Route path="internships" element={<ByRole student={<StudentInternships />} employer={<EmployerInternships />} />} />
        <Route path="standards" element={<ByRole employer={<EmployerStandards />} institution={<InstitutionStandards />} />} />
        <Route path="assessments" element={<ByRole student={<StudentAssessments />} employer={<AssessmentsManager />} institution={<AssessmentsManager />} />} />
        <Route path="evidence" element={<ByRole student={<MyEvidence />} />} />
        <Route path="evidence/:id" element={<ByRole student={<EvidenceEditor />} />} />
        <Route path="journey" element={<ByRole student={<Journey />} />} />
        <Route path="profile" element={<ByRole student={<Profile />} />} />
        <Route path="review" element={<ByRole employer={<Review />} />} />
        <Route path="talent" element={<ByRole employer={<Talent />} />} />
        <Route path="feedback" element={<ByRole employer={<Feedback />} />} />
        <Route path="demand" element={<ByRole institution={<Demand />} />} />
        <Route path="gap" element={<ByRole institution={<Gap />} />} />
        <Route path="programmes" element={<ByRole institution={<Programmes />} />} />
        <Route path="enrollments" element={<ByRole institution={<Enrolments />} />} />
        <Route path="outcomes" element={<ByRole institution={<Outcomes />} />} />
        <Route path="actions" element={<ByRole institution={<Actions />} />} />
        <Route path="requirements" element={<ByRole regulator={<Requirements />} />} />
        <Route path="compliance" element={<ByRole regulator={<Compliance />} />} />
        <Route path="admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
