export const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${sizes[i]}`;
};

export const formatLastSeen = (timestamp: number, now: number): string => {
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 2) return "Connected now";
  if (minutes < 60) return `Last seen ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours} h ago`;
  return `Last seen ${new Date(timestamp).toLocaleDateString()}`;
};
