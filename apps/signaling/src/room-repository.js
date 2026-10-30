export class RoomRepository {
  get(_roomCode) { throw new Error("RoomRepository.get is not implemented"); }
  set(_room) { throw new Error("RoomRepository.set is not implemented"); }
  delete(_roomCode) { throw new Error("RoomRepository.delete is not implemented"); }
  values() { throw new Error("RoomRepository.values is not implemented"); }
}

// Replaceable storage boundary. This MVP keeps state in this process only.
export class MemoryRoomRepository extends RoomRepository {
  #rooms = new Map();

  get(roomCode) { return this.#rooms.get(roomCode); }
  set(room) { this.#rooms.set(room.roomCode, room); }
  delete(roomCode) { return this.#rooms.delete(roomCode); }
  values() { return this.#rooms.values(); }
}
