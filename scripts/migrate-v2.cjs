// Run with Firebase Admin ADC during a maintenance window. No credentials are stored here.
const {initializeApp,getApps}=require('../functions/node_modules/firebase-admin/app')
const {getDatabase}=require('../functions/node_modules/firebase-admin/database')
const {createHash}=require('node:crypto')
if(!getApps().length)initializeApp({databaseURL:'https://room-live-manager-default-rtdb.asia-southeast1.firebasedatabase.app'})
const db=getDatabase()
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
const array=x=>Array.isArray(x)?x:x&&typeof x==='object'?Object.values(x):[]
const financeLog=s=>/결제|장부|미수|원 →|원 ·/.test(s||'')
async function main(){
  const source=(await db.ref('roomLive').get()).val()
  if(!source)throw Error('Legacy data missing; refusing migration')
  const v2=db.ref('roomLiveV2')
  const current=(await v2.get()).val()
  if(current?.config?.active)throw Error('V2 is active; migration refused')
  const replace=process.argv.includes('--replace-staging')
  if((current?.operations||current?.finance)&&!replace)throw Error('V2 staging exists. Back up and use --replace-staging during a maintenance window.')
  if(replace){
    const backup=await db.ref('roomLiveLedgerMigration/v2CutoverBackup').transaction(old=>old??{legacy:source,staging:current??null,createdAt:Date.now()},undefined,false)
    if(!backup.committed&&!backup.snapshot.exists())throw Error('Unable to preserve migration backup')
  }
  const {payments,...operations}=source
  operations.logs=array(source.logs).filter(log=>!financeLog(log.action))
  const finance={schemaVersion:2,payments:array(payments)}
  const again=(await db.ref('roomLive').get()).val()
  if(hash(source)!==hash(again))throw Error('Legacy data changed during migration; retry during maintenance window')
  const result=await v2.transaction(value=>{
    if(value?.config?.active||((value?.operations||value?.finance)&&!replace))return
    return {...(value||{}),operations,finance,config:{active:false}}
  },undefined,false)
  if(!result.committed)throw Error('V2 changed concurrently; nothing overwritten')
  const stored=(await v2.get()).val()
  if(hash(array(stored.finance.payments))!==hash(finance.payments))throw Error('Finance verification failed')
  console.log('Staging complete. Payments:',finance.payments.length,'amount:',finance.payments.reduce((sum,p)=>sum+Number(p.amount||0),0))
  console.log('DO NOT enable config.active until Functions, rules and client have been verified.')
}
main().catch(error=>{console.error(error);process.exitCode=1})
