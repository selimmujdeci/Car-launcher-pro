type CommandAuthorityHandle = {
  clear(): void;
  isEmpty(): boolean;
};

const commandHandles = new Set<CommandAuthorityHandle>();

export function registerCommandAuthorityHandle(
  handle: CommandAuthorityHandle,
): () => void {
  commandHandles.add(handle);
  return () => commandHandles.delete(handle);
}

export function clearRegisteredCommandAuthority(): void {
  commandHandles.forEach((handle) => handle.clear());
}

export function verifyRegisteredCommandAuthorityEmpty(): boolean {
  return Array.from(commandHandles).every((handle) => handle.isEmpty());
}
