import { useState } from 'react';
import { StyleSheet, View, Text, ScrollView, TextInput } from 'react-native';
import { useSearch, getSearchQueryKey } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { ProductCard } from '@/components/ProductCard';
import { StoreCard } from '@/components/StoreCard';
import { EmptyState } from '@/components/EmptyState';
import { Feather } from '@expo/vector-icons';
import { LoadingScreen } from '@/components/Loading';

export default function SearchScreen() {
  const colors = useColors();
  const [query, setQuery] = useState('');
  // Use debounced value or just trigger search when length >= 2
  const { data, isLoading } = useSearch({ q: query }, { query: { enabled: query.length >= 2, queryKey: getSearchQueryKey({ q: query }) } });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={[styles.searchBar, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Feather name="search" size={20} color={colors.mutedForeground} style={styles.searchIcon} />
          <TextInput
            style={[styles.input, { color: colors.foreground }]}
            placeholder="Search products or stores..."
            placeholderTextColor={colors.mutedForeground}
            value={query}
            onChangeText={setQuery}
            autoFocus
          />
          {query.length > 0 && (
            <Feather 
              name="x" 
              size={20} 
              color={colors.mutedForeground} 
              onPress={() => setQuery('')}
              style={styles.clearIcon}
            />
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {query.length < 2 ? (
          <EmptyState 
            icon="search" 
            title="Search Dodolink" 
            description="Find products, electronics, clothing, and stores across the market."
          />
        ) : isLoading ? (
          <LoadingScreen message="Searching..." />
        ) : data && (data.products.length > 0 || data.stores.length > 0) ? (
          <>
            {data.stores.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Stores</Text>
                {data.stores.map(store => (
                  <StoreCard key={store.id} store={store} />
                ))}
              </View>
            )}

            {data.products.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Products</Text>
                <View style={styles.grid}>
                  {data.products.map(product => (
                    <View key={product.id} style={styles.gridItem}>
                      <ProductCard product={product} />
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        ) : (
          <EmptyState 
            icon="inbox" 
            title="No results found" 
            description={`We couldn't find anything matching "${query}".`}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  searchIcon: {
    marginRight: 8,
  },
  clearIcon: {
    marginLeft: 8,
  },
  input: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    height: '100%',
  },
  content: {
    padding: 16,
    paddingBottom: 100,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -8,
  },
  gridItem: {
    width: '50%',
    paddingHorizontal: 8,
  },
});
