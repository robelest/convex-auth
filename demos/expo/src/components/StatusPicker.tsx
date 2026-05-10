import React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";

import { colors, statusColors, spacing, fontSize, radius } from "@/src/theme";

const STATUSES = [
  "in_progress",
  "todo",
  "backlog",
  "done",
  "cancelled",
] as const;
const LABELS: Record<string, string> = {
  in_progress: "In Progress",
  todo: "Todo",
  backlog: "Backlog",
  done: "Done",
  cancelled: "Cancelled",
};

export const StatusPicker = React.memo(function StatusPicker({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (status: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}
    >
      {STATUSES.map((status) => {
        const active = value === status;
        const dotColor = statusColors[status];
        return (
          <Pressable
            key={status}
            onPress={() => onSelect(status)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs + 2,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm - 1,
              borderRadius: radius.xl,
              borderWidth: 1,
              borderCurve: "continuous",
              borderColor: active ? dotColor + "40" : colors.warm[300],
              backgroundColor: active ? dotColor + "18" : colors.white,
            }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
            <Text style={{
              fontSize: fontSize.sm + 1,
              color: active ? colors.warm[900] : colors.warm[600],
              fontWeight: active ? "600" : "400",
            }}>
              {LABELS[status]}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});
