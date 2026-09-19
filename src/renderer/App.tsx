import { Routes, Route, Navigate } from 'react-router-dom'
import SplashView from './views/SplashView'
import LoginView from './views/LoginView'
import HomeView from './views/HomeView'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SplashView />} />
      <Route path="/login" element={<LoginView />} />
      <Route path="/home" element={<HomeView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}