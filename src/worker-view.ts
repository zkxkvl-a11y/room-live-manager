import type { Store } from './store-model'

export function workerViewOf(source:Store){
    // Strict allowlist: never copy payments, logs, sessions, visits or any free-form finance notes.
    return {
      rooms:source.rooms.map(room=>({id:room.id,uid:room.uid??room.id,groupId:room.groupId??null,started:room.started,ends:room.ends,tags:room.tags})),
      attendance:(source.attendance??[]).map(person=>({id:person.id,name:person.name,working:person.working})),
      shops:(source.shops??[]).map(shop=>({id:shop.id,name:shop.name})),
      groups:(source.groups??[]).map(group=>({id:group.id,shopId:group.shopId,name:group.name,layout:group.layout??[]})),
      updatedAt:Date.now()
    }
  }
