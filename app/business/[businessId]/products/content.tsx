    /* eslint-disable @next/next/no-img-element */
"use client";

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useProductContext } from '@/app/lib/context/ProductContext';
import { useBusinessContext } from '@/app/lib/context/BusinessContext';
import { useUserContext } from '@/app/lib/context/UserContext';
import { Loader2, Package, PlusCircle, AlertCircle, Settings, Eye, Edit3, Search, Camera, X } from 'lucide-react'; // Added Package, Edit3, Search, Camera, X
import { ProductWithIncludes } from '@/backend/services/products/products.types';

const BusinessProductsListContent: React.FC = () => {
  const params = useParams();
  const router = useRouter();
  const businessId = params.businessId as string;

  const { user, user_loading } = useUserContext();
  const {
    products,
    fetchProducts,
    product_loading,
    error_product,
    searchProductsByName,
    searchProductsByImageUrl
  } = useProductContext();
  const {
    business,
    fetchBusiness,
    businessLoading,
    businessError
  } = useBusinessContext();

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<'browse' | 'text' | 'image'>('browse');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (businessId && user) {
      fetchBusiness(businessId); // Fetch business details for context (e.g., name)
      fetchProducts({ filter: { businessId } }); // Fetch products for this business
    }
  }, [businessId, user, fetchBusiness, fetchProducts]);

  // Helper function to convert file to data URL
  const fileToDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Handle text search
  const handleTextSearch = async () => {
    if (!searchQuery.trim()) {
      // If search is empty, fetch all products
      setSearchMode('browse');
      await fetchProducts({ filter: { businessId } });
      return;
    }

    setIsSearching(true);
    setSearchMode('text');
    try {
      await searchProductsByName(searchQuery.trim(), businessId);
    } catch (error) {
      console.error('Text search failed:', error);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle image search
  const handleImageSearch = async (file: File) => {
    setIsSearching(true);
    setSearchMode('image');
    try {
      const dataURL = await fileToDataURL(file);
      await searchProductsByImageUrl(dataURL, businessId);
    } catch (error) {
      console.error('Image search failed:', error);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle file input change
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleImageSearch(file);
    }
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Clear search and go back to browse mode
  const clearSearch = () => {
    setSearchQuery('');
    setSearchMode('browse');
    fetchProducts({ filter: { businessId } });
  };

  // Handle Enter key press for search
  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleTextSearch();
    }
  };

  const ProductCard: React.FC<{ product: ProductWithIncludes }> = ({ product }) => {
    const priceValue = product.price ? parseFloat(product.price) : null;
    return (
      <div className="bg-[var(--bg-card)] p-5 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 ease-in-out flex flex-col justify-between">
        <div>
          {/* Product Image */}
          {product.imageUrl ? (
            <div className="w-full h-48 mb-4 rounded-lg overflow-hidden bg-[var(--bg-badge)]">
              <img
                src={product.imageUrl}
                alt={product.name || 'Product image'}
                width={300}
                height={200}
                className="w-full h-full object-cover"
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              />
            </div>
          ) : (
            <div className="w-full h-48 mb-4 rounded-lg bg-[var(--bg-badge)] flex items-center justify-center">
              <Package className="h-16 w-16 text-[var(--icon-accent-primary)] opacity-50" />
            </div>
          )}

          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center flex-1 min-w-0">
              <Package className="h-7 w-7 text-[var(--icon-accent-primary)] mr-3 flex-shrink-0" />
              <h3 className="text-xl font-semibold text-[var(--text-on-dark-primary)] truncate" title={product.name || `Product ID: ${product.productId}`}>
                {product.name || `Product ${product.productId.substring(0, 8)}...`}
              </h3>
            </div>
            {product.similarity !== null && product.similarity !== undefined && (
              <div className="ml-2 px-2 py-1 bg-[var(--color-accent-primary)] text-white text-xs rounded-full font-medium flex-shrink-0">
                {Math.round(product.similarity * 100)}% match
              </div>
            )}
          </div>
          <p className="text-sm text-[var(--text-on-dark-muted)] mb-1">
            Price: <span className="font-medium text-[var(--text-on-dark-secondary)]">${priceValue !== null && !isNaN(priceValue) ? priceValue.toFixed(2) : 'N/A'}</span>
          </p>
          <p className="text-sm text-[var(--text-on-dark-muted)] mb-1">
            SKU: <span className="font-medium text-[var(--text-on-dark-secondary)]">{product.sku || 'N/A'}</span>
          </p>
          {product.description && (
            <p className="text-sm text-[var(--text-on-dark-muted)] mt-2 mb-3 line-clamp-2" title={product.description}>
              {product.description}
            </p>
          )}
          {/* Stock display removed as product.sku was incorrectly used and no direct stock field available */}
        </div>
        <div className="flex justify-end space-x-2 mt-auto pt-3 border-t border-[var(--border-light)]">
          <button
            onClick={() => router.push(`/business/${businessId}/products/${product.productId}`)}
            className="p-2 text-xs bg-[var(--bg-accent)] hover:bg-[var(--bg-accent-hover)] text-[var(--text-on-dark-secondary)] rounded-md transition-colors flex items-center"
            title="View Product Details"
          >
            <Eye size={14} className="mr-1" /> View
          </button>
          <button
            onClick={() => router.push(`/business/${businessId}/products/${product.productId}/update`)}
            className="p-2 text-xs bg-[var(--color-accent-secondary)] hover:bg-opacity-80 text-white rounded-md transition-colors flex items-center"
            title="Edit Product"
          >
            <Edit3 size={14} className="mr-1" /> Edit
          </button>
        </div>
      </div>
    );
  };

  if (user_loading || (businessLoading && !business) || (product_loading && products.length === 0 && !error_product && !businessError)) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-on-dark-primary)] flex flex-col items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-[var(--icon-accent-primary)]" />
        <p className="mt-4 text-lg">Loading products...</p>
      </div>
    );
  }

  if (!user && !user_loading) {
    router.push('/user/signIn');
    return null;
  }

  if (businessError) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-on-dark-primary)] flex flex-col items-center justify-center p-4">
        <AlertCircle className="h-12 w-12 text-[var(--text-error)] mb-4" />
        <h2 className="text-2xl font-semibold mb-2 text-[var(--text-error)]">Error Loading Business</h2>
        <p className="text-center text-[var(--text-on-dark-muted)]">{businessError}</p>
        <Link href="/home" className="mt-6 px-4 py-2 bg-[var(--color-accent-primary)] text-white rounded-md hover:bg-opacity-80 transition-colors">
          Go to Home
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold text-[var(--text-page-heading)]">
            Products for {business?.name || 'Business'}
          </h2>
          <p className="text-[var(--text-on-dark-muted)] mt-1">Manage all your products.</p>
        </div>
        <Link
          href={`/business/${businessId}/products/new`}
          className="mt-4 sm:mt-0 px-5 py-2.5 bg-[var(--color-accent-primary)] text-white font-semibold rounded-lg hover:bg-opacity-80 transition-colors flex items-center justify-center whitespace-nowrap"
        >
          <PlusCircle className="h-5 w-5 mr-2" />
          Add New Product
        </Link>
      </div>

      {/* Search Bar */}
      <div className="mb-6 bg-[var(--bg-card)] p-4 rounded-lg shadow-md">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Text Search Input */}
          <div className="flex-1 relative">
            <div className="relative">
              <input
                type="text"
                placeholder="Search products by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={handleKeyPress}
                className="w-full pl-10 pr-10 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-light)] rounded-lg text-[var(--text-on-dark-primary)] placeholder-[var(--text-on-dark-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)] focus:border-transparent"
              />
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--text-on-dark-muted)]" />
              {searchQuery && (
                <button
                  onClick={clearSearch}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--text-on-dark-muted)] hover:text-[var(--text-on-dark-primary)] transition-colors"
                  title="Clear search"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Search Button */}
          <button
            onClick={handleTextSearch}
            disabled={isSearching || product_loading}
            className="px-4 py-2.5 bg-[var(--color-accent-primary)] text-white rounded-lg hover:bg-opacity-80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[100px]"
          >
            {isSearching && searchMode === 'text' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Search className="h-4 w-4 mr-2" />
                Search
              </>
            )}
          </button>

          {/* Image Search Button */}
          <div className="relative">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isSearching || product_loading}
              className="px-4 py-2.5 bg-[var(--color-accent-secondary)] text-white rounded-lg hover:bg-opacity-80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[120px]"
              title="Search by image"
            >
              {isSearching && searchMode === 'image' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Camera className="h-4 w-4 mr-2" />
                  Image Search
                </>
              )}
            </button>
          </div>
        </div>

        {/* Search Mode Indicator */}
        {searchMode !== 'browse' && (
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center text-sm text-[var(--text-on-dark-muted)]">
              {searchMode === 'text' && (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Searching for: &quot;{searchQuery}&quot;
                </>
              )}
              {searchMode === 'image' && (
                <>
                  <Camera className="h-4 w-4 mr-2" />
                  Image search results
                </>
              )}
            </div>
            <button
              onClick={clearSearch}
              className="text-sm text-[var(--color-accent-primary)] hover:text-opacity-80 transition-colors flex items-center"
            >
              <X className="h-4 w-4 mr-1" />
              Clear search
            </button>
          </div>
        )}
      </div>

      {product_loading && !error_product && (
        <div className="flex justify-center items-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--icon-accent-primary)]" />
          <p className="ml-3 text-[var(--text-on-dark-secondary)]">Fetching products...</p>
        </div>
      )}

      {error_product && (
        <div className="my-6 p-4 bg-red-500/10 text-red-400 border border-red-500/30 rounded-md flex items-center">
          <AlertCircle className="h-6 w-6 mr-3 flex-shrink-0" />
          <div>
            <h4 className="font-semibold">Failed to load products</h4>
            <p className="text-sm">{error_product}</p>
          </div>
        </div>
      )}

      {!product_loading && !error_product && products.length === 0 && (
        <div className="text-center py-12 bg-[var(--bg-secondary)] rounded-lg shadow">
          <Package className="h-16 w-16 text-[var(--icon-accent-primary)] mx-auto mb-4 opacity-50" />
          <h3 className="text-xl font-semibold text-[var(--text-on-dark-primary)] mb-2">No Products Found</h3>
          {searchMode === "browse" && (
            <>
              <p>
                Get started by adding your first product.
              </p>

              <Link
                href={`/business/${businessId}/products/new`}
                className="px-6 py-2.5 bg-[var(--color-accent-primary)] text-white font-semibold rounded-md hover:bg-opacity-80 transition-colors inline-flex items-center"
              >
                <PlusCircle className="h-5 w-5 mr-2" />
                Add Product
              </Link>
            </>
          )}
        </div>
      )}

      {!product_loading && !error_product && products.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {products.map(product => (
            <ProductCard key={product.productId} product={product} />
          ))}
        </div>
      )}
    </>
  );
};

export default BusinessProductsListContent;
