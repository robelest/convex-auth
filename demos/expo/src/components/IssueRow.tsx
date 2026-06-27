import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";

import { colors, spacing, fontSize, recipes } from "@/src/theme";

import { PriorityChip } from "./PriorityChip";
import { StatusDot } from "./StatusDot";

interface IssueItem {
  _id: string;
  identifier: string;
  title: string;
  status: "backlog" | "todo" | "in_progress" | "done" | "cancelled";
  priority: "none" | "low" | "medium" | "high" | "urgent";
  assigneeName: string | null;
}

export const IssueRow = React.memo(function IssueRow({
  issue,
  onPress,
}: {
  issue: IssueItem;
  onPress?: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={onPress}>
      <StatusDot status={issue.status} />
      <Text style={styles.identifier}>{issue.identifier}</Text>
      <View style={styles.titleWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {issue.title}
        </Text>
      </View>
      <View style={styles.trailing}>
        <PriorityChip priority={issue.priority} />
        {issue.assigneeName && (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{issue.assigneeName.charAt(0)}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 1,
    backgroundColor: colors.background.secondary,
    ...recipes.rowBorder,
  },
  pressed: { ...recipes.rowPressed },
  identifier: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.warm[500],
    marginLeft: spacing.sm + 2,
    width: 52,
  },
  titleWrap: { flex: 1, marginLeft: spacing.xs + 2 },
  title: { fontSize: fontSize.md, color: colors.warm[900] },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    marginLeft: spacing.xs + 2,
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.util.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 9, fontWeight: "700", color: colors.content.primary },
});
