import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type State={error:Error|null}
export default class AppErrorBoundary extends Component<{children:ReactNode},State>{
  state:State={error:null}
  static getDerivedStateFromError(error:Error):State{return {error}}
  componentDidCatch(error:Error,info:ErrorInfo){
    console.error('ROOM LIVE render failed',error,info.componentStack)
  }
  render(){
    if(!this.state.error)return this.props.children
    return <main style={{padding:24,fontFamily:'system-ui',color:'#111',background:'#fff',minHeight:'100vh'}}>
      <h1>ROOM LIVE 실행 오류</h1>
      <p>화면 표시 중 오류가 발생했습니다. 아래 오류 내용을 복사해 전달해 주세요.</p>
      <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',padding:12,background:'#f2f2f2',borderRadius:8}}>{this.state.error.message}</pre>
      <button onClick={()=>window.location.reload()} style={{padding:12}}>다시 시도</button>
    </main>
  }
}
