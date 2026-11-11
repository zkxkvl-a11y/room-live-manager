import { useState } from 'react'
import './App.css'

export default function App() {
  const [count, setCount] = useState(0)
  return <main><h1>ROOM LIVE</h1><p>GitHub 연결 및 파일 버전 충돌 복구 테스트</p><button onClick={() => setCount(n => n + 1)}>테스트 {count}</button></main>
}
