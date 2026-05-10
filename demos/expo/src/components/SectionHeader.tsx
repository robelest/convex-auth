import React from "react";
import { View, Text, StyleSheet } from "react-native";

import { colors, spacing, fontSize } from "@/src/theme";

export const SectionHeader = React.memo(function SectionHeader({
  title,
  count,
}: {
  title: string;
  count: number;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.count}>{count}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.warm[50],
  },
  title: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: colors.warm[500],
  },
  count: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.warm[400],
  },
});
