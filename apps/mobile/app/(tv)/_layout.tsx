import { Stack } from "expo-router";
import { colors } from "../../theme";
import { useTVBackNavigation } from "../../components/tv/tvBack";

export default function TVLayout() {
  useTVBackNavigation();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: colors.background,
        },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="player/[id]"
        options={{
          headerShown: false,
          presentation: "fullScreenModal",
        }}
      />
      <Stack.Screen name="settings" options={{ headerShown: false }} />
      <Stack.Screen name="connect" options={{ headerShown: false }} />
      <Stack.Screen name="channel/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
