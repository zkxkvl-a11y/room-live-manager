import type { AttendanceShift, Visit } from './store-model'
export type TimeRange={start:number;end:number}
export function mergedDuration(ranges:TimeRange[]):number{
  const sorted=ranges.filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.end>r.start).sort((a,b)=>a.start-b.start)
  let total=0,start=0,end=0
  for(const r of sorted){
    if(!end){start=r.start;end=r.end;continue}
    if(r.start<=end){end=Math.max(end,r.end);continue}
    total+=end-start;start=r.start;end=r.end
  }
  return total+(end?end-start:0)
}
export function shiftSummary(shift:AttendanceShift,visits:Visit[],now:number){
  const end=shift.clockOut??now
  const total=Math.max(0,end-shift.clockIn)
  const roomRanges=visits.filter(v=>v.tag===shift.tag).map(v=>({start:Math.max(v.entered,shift.clockIn),end:Math.min(v.exited??now,end)}))
  const room=Math.min(total,mergedDuration(roomRanges))
  return {total,room,waiting:Math.max(0,total-room)}
}
export function shiftDate(timestamp:number){return new Date(timestamp+9*3600000).toISOString().slice(0,10)}
export function timeLength(ms:number){const m=Math.floor(Math.max(0,ms)/60000);return Math.floor(m/60)+'시간 '+String(m%60).padStart(2,'0')+'분'}
