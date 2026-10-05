import { Ionicons } from "@expo/vector-icons";
import { Surface, useThemeColor } from "heroui-native";
import { Text, View } from "react-native";

import { Container } from "@/components/container";

export default function AIScreen() {
  const mutedColor = useThemeColor("muted");

  return (
    <Container className="px-4">
      <View className="flex-1 items-center justify-center gap-3 py-16">
        <Surface variant="secondary" className="h-14 w-14 items-center justify-center rounded-full">
          <Ionicons name="chatbubble-ellipses-outline" size={28} color={mutedColor} />
        </Surface>
        <Text className="text-center text-xl font-semibold text-foreground">Assistant</Text>
        <Text className="text-center text-sm leading-5 text-muted">
          The assistant is not connected. It will return with the new backend.
        </Text>
      </View>
    </Container>
  );
}
