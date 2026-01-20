export const formatIdleLine = ({
  idleMinutes,
}: {
  idleMinutes: number;
}): string => {
  if (idleMinutes < 60) {
    return `${idleMinutes}m`;
  }
  const hours = Math.floor(idleMinutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d`;
  }
  const months = Math.floor(days / 30);
  return `${months}mo`;
};
