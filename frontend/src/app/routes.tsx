import { createBrowserRouter } from 'react-router';
import { PlayPage } from './pages/PlayPage';
import { EditPage } from './pages/EditPage';
import { DashboardPage } from './pages/DashboardPage';
import { ConvertPage } from './pages/ConvertPage';

const routeConfig = [
  { path: '/',          Component: PlayPage },
  { path: '/editor',    Component: EditPage },
  { path: '/convert',   Component: ConvertPage },
  { path: '/dashboard', Component: DashboardPage },
];

export const router = createBrowserRouter(routeConfig, {
  basename: '/I-DOJO',
});
