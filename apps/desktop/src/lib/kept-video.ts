// A kept Video is on its way until its fetch completes or fails.
export const isOnItsWay = (status: string | null): boolean =>
  status !== null && status !== "completed" && status !== "failed";
