import { useState } from 'react';
import { useApp } from './state/AppContext.jsx';
import Login from './ui/Login.jsx';
import ServerRail from './ui/ServerRail.jsx';
import SidePanel from './ui/SidePanel.jsx';
import ChatView from './ui/ChatView.jsx';
import MemberList from './ui/MemberList.jsx';
import Toasts from './ui/Toasts.jsx';
import CallOverlay from './ui/CallOverlay.jsx';

export default function App() {
  const { me, loading } = useApp();
  const [showMembers, setShowMembers] = useState(true);

  if (loading) return <div className="splash">Loading…</div>;
  if (!me) return <Login />;

  return (
    <div className="app">
      <ServerRail />
      <SidePanel />
      <ChatView showMembers={showMembers} toggleMembers={() => setShowMembers((v) => !v)} />
      {showMembers && <MemberList />}
      <Toasts />
      <CallOverlay />
    </div>
  );
}
