import { createBrowserRouter } from 'react-router';
import { PlayPage } from './pages/PlayPage';
import { EditPage } from './pages/EditPage';
import { DashboardPage } from './pages/DashboardPage';
import { ConvertPage } from './pages/ConvertPage';

// / = เกมไม่จับเวลา · /timed = เกมจับเวลา (ใช้ timeLimitSeconds ของชุดคำถาม) — ชุดคำถามเดียวกัน
const routeConfig = [
  { path: '/',          Component: PlayPage },
  { path: '/timed',     Component: TimedPlayPage },
  { path: '/editor',    Component: EditPage },
  { path: '/convert',   Component: ConvertPage },
  { path: '/dashboard', Component: DashboardPage },
];

function TimedPlayPage() {
  return <PlayPage timed />;
}

export const router = createBrowserRouter(routeConfig, {
  basename: '/I-DOJO',
});
