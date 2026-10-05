import { Surface } from "heroui-native";
import { Text, View } from "react-native";

import { Container } from "@/components/container";

export default function Home() {
  return (
    <Container className="px-4 pb-4">
      <View className="py-6 mb-5">
        <Text className="text-3xl font-semibold text-foreground tracking-tight">RITAA</Text>
        <Text className="text-muted text-sm mt-1">
          Ramco Institute of Technology Alumni Association
        </Text>
      </View>

      <Surface variant="secondary" className="p-4 rounded-xl">
        <Text className="text-foreground font-medium">Preview</Text>
        <Text className="text-muted text-xs mt-1">
          This app is a local screen. Account sign-in and live alumni data will
          connect when the new backend is in place.
        </Text>
      </Surface>
    </Container>
  );
}
