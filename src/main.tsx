import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initDatabase } from './services/db'
import { installSpeculaApi } from './services/specula'
import { seedSampleBooks } from './services/book.service'

async function bootstrap() {
  installSpeculaApi()
  await initDatabase()
  await seedSampleBooks().catch((err) => console.warn('Failed to seed sample books:', err))

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

bootstrap().catch((err) => {
  console.error('Failed to start Specula:', err)
  document.body.innerHTML = `<div style="padding:2rem;font-family:system-ui;color:#b91c1c">启动失败：${err instanceof Error ? err.message : String(err)}</div>`
})
