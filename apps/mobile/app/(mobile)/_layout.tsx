import { Stack } from "expo-router";
import { colors } from "../../theme";

export default function MobileLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: colors.background,
        },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="player/[id]"
        options={{
          headerShown: false,
          presentation: "fullScreenModal",
        }}
      />
      <Stack.Screen
        name="share"
        options={{
          title: "Share",
          headerShown: false,
          presentation: "modal",
          headerStyle: {
            backgroundColor: colors.card,
          },
          headerTintColor: colors.foreground,
        }}
      />
      <Stack.Screen
        name="connect"
        options={{
          title: "Pair with desktop",
          headerShown: false,
          presentation: "modal",
          headerStyle: {
            backgroundColor: colors.card,
          },
          headerTintColor: colors.foreground,
        }}
      />
    </Stack>
  );
}
