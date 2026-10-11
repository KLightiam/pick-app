import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

// Small shared building blocks so every screen looks the same.

export const colors = {
  brand: '#0B6E4F',
  brandText: '#FFFFFF',
  text: '#1A1A1A',
  muted: '#6B6B6B',
  border: '#DDDDDD',
  surface: '#F5F5F2',
  background: '#FFFFFF',
  danger: '#B3261E',
};

export function Screen({ children }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Title({ children }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Body({ children, muted, style }) {
  return <Text style={[styles.body, muted && styles.muted, style]}>{children}</Text>;
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <Text style={styles.error}>{children}</Text>;
}

export function Button({ title, onPress, busy, disabled, variant = 'primary' }) {
  const off = disabled || busy;
  const secondary = variant === 'secondary';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        (pressed || off) && { opacity: 0.6 },
      ]}
    >
      {busy
        ? <ActivityIndicator color={secondary ? colors.brand : colors.brandText} />
        : <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...props }) {
  return (
    <View style={styles.field}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput placeholderTextColor={colors.muted} style={styles.input} {...props} />
    </View>
  );
}

/** A row of choices where one is selected, e.g. Solo | Shared. */
export function Choice({ options, value, onChange }) {
  return (
    <View style={styles.choice}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="button"
          accessibilityState={{ selected: o.value === value }}
          onPress={() => onChange(o.value)}
          style={[styles.choiceItem, o.value === value && styles.choiceItemOn]}
        >
          <Text style={[styles.choiceText, o.value === value && styles.choiceTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A number picker with − and + buttons. */
export function Stepper({ label, value, min, max, onChange }) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.body}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable accessibilityLabel={`Fewer ${label}`} onPress={() => onChange(Math.max(min, value - 1))} style={styles.stepperButton}>
          <Text style={styles.stepperSign}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{value}</Text>
        <Pressable accessibilityLabel={`More ${label}`} onPress={() => onChange(Math.min(max, value + 1))} style={styles.stepperButton}>
          <Text style={styles.stepperSign}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function Card({ children, onPress, selected }) {
  const Box = onPress ? Pressable : View;
  return <Box onPress={onPress} style={[styles.card, selected && styles.cardSelected]}>{children}</Box>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, gap: 14, backgroundColor: colors.background },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  body: { fontSize: 16, color: colors.text },
  muted: { color: colors.muted, fontSize: 14 },
  error: { color: colors.danger, fontSize: 14 },
  button: {
    backgroundColor: colors.brand, borderRadius: 10, paddingVertical: 14, alignItems: 'center', minHeight: 50,
    justifyContent: 'center',
  },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.brand },
  buttonDanger: { backgroundColor: colors.danger },
  buttonText: { color: colors.brandText, fontSize: 16, fontWeight: '600' },
  buttonTextSecondary: { color: colors.brand },
  field: { gap: 6 },
  label: { fontSize: 14, color: colors.muted },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 16, color: colors.text, backgroundColor: colors.background,
  },
  choice: { flexDirection: 'row', borderRadius: 10, backgroundColor: colors.surface, padding: 4 },
  choiceItem: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  choiceItemOn: { backgroundColor: colors.background, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 1 },
  choiceText: { fontSize: 15, color: colors.muted },
  choiceTextOn: { color: colors.text, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepperButton: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  stepperSign: { fontSize: 20, color: colors.text },
  stepperValue: { fontSize: 18, minWidth: 20, textAlign: 'center', color: colors.text },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, gap: 4 },
  cardSelected: { borderColor: colors.brand, borderWidth: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
});
