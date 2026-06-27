import React from "react";
import { View, StyleSheet } from "react-native";

import { statusColors } from "@/src/theme";

type IssueStatus = "backlog" | "todo" | "in_progress" | "done" | "cancelled";

export const StatusDot = React.memo(function StatusDot({ status }: { status: IssueStatus }) {
  return <View style={[styles.dot, { backgroundColor: statusColors[status] }]} />;
});

const styles = StyleSheet.create({
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
