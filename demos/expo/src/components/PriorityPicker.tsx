import React from "react";
import { Text, Pressable, ScrollView } from "react-native";

import { colors, priorityColors, spacing, fontSize, radius } from "@/src/theme";

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
const LABELS: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const PriorityPicker = React.memo(function PriorityPicker({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (priority: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}
    >
      {PRIORITIES.map((priority) => {
        const active = value === priority;
        const c = priorityColors[priority];
        return (
          <Pressable
            key={priority}
            onPress={() => onSelect(priority)}
            style={{
              paddingHorizontal: spacing.lg - 2,
              paddingVertical: spacing.sm - 1,
              borderRadius: radius.xl,
              borderWidth: 1,
              borderCurve: "continuous",
              backgroundColor: active ? c.bg : colors.white,
              borderColor: active ? c.border : colors.warm[300],
            }}
          >
            <Text style={{
              fontSize: fontSize.sm + 1,
              color: active ? c.text : colors.warm[600],
              fontWeight: active ? "600" : "400",
            }}>
              {LABELS[priority]}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});
