import { QueryClient } from "@tanstack/react-query";

/** The one React Query cache of the renderer, for code outside components too. */
export const queryClient = new QueryClient({});
