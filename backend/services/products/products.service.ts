import { db } from '@/db';
import { products, users, businesses, orderItems } from '@/db/schema'; // Ensure all needed tables are imported
import {
  Product,
  NewProduct, // Added import for NewProduct
  CreateProductData,
  UpdateProductData,
  GetProductByIdOptions,
  GetAllProductsOptions,
  ProductFilterOptions, // Ensure this is the one being used for filter type
  UpdateManyProductsData,
  ProductWithIncludes,
} from './products.types';
import { and, or, count, eq, ilike, inArray, gte, lte, desc } from 'drizzle-orm'; // Added 'or'

export class ProductsService {
  constructor() {}

  async createProduct(data: CreateProductData): Promise<Product> {
    const newProductData: NewProduct = {
      businessId: data.businessId,
      providerUserId: data.providerUserId, // Can be null or undefined
      name: data.name,
      description: data.description,
      price: data.price,
      currency: data.currency,
      sku: data.sku,
      imageUrl: data.imageUrl,
      imageId: data.imageId,
      shortId: data.shortId,
      isAvailable: data.isAvailable,
    };
    const [newProduct] = await db.insert(products).values(newProductData).returning();
    return newProduct;
  }

  async getProductById(productId: string, options?: GetProductByIdOptions): Promise<ProductWithIncludes | null> {
    const query = db.query.products.findFirst({
      where: eq(products.productId, productId),
      with: {
        business: options?.include?.business ? true : undefined,
        userViaProviderId: options?.include?.userViaProviderId ? true : undefined, // For denormalized user
        orderItems: options?.include?.orderItems
          ? {
              limit: typeof options.include.orderItems === 'boolean' ? undefined : options.include.orderItems.limit,
              // offset is not directly supported in nested 'with' like this for eager loading
              with: {
                order: typeof options.include.orderItems === 'object' && options.include.orderItems.include?.order ? true : undefined,
              },
            }
          : undefined,
      }
    });
    const product = await query;
    return product || null;
  }

  async getAllProducts(options?: GetAllProductsOptions): Promise<{ data: ProductWithIncludes[]; total: number }> {
    const page = options?.limit ?? 10;
    const offset = options?.offset ?? 0;

    // Explicitly type the filter object using ProductFilterOptions
    const filter: ProductFilterOptions | undefined = options?.filter;
    const conditions = [];

    if (filter?.name) {
      conditions.push(ilike(products.name, `%${filter.name}%`));
    }
    if (filter?.businessId) { // Filter by businessId
      conditions.push(eq(products.businessId, filter.businessId));
    }
    if (filter?.providerUserId) { // Filter by denormalized providerUserId
      conditions.push(eq(products.providerUserId, filter.providerUserId));
    }
    // Removed old userId and channelId filters
    if (filter?.isAvailable !== undefined) {
      conditions.push(eq(products.isAvailable, filter.isAvailable));
    }
    if (filter?.currency) {
      conditions.push(eq(products.currency, filter.currency));
    }
    if (filter?.minPrice !== undefined) {
      conditions.push(gte(products.price, filter.minPrice.toString()));
    }
    if (filter?.maxPrice !== undefined) {
      conditions.push(lte(products.price, filter.maxPrice.toString()));
    }
    if (filter?.createdAtBefore) {
      conditions.push(lte(products.createdAt, filter.createdAtBefore));
    }
    if (filter?.createdAtAfter) {
      conditions.push(gte(products.createdAt, filter.createdAtAfter));
    }
    if (filter?.imageId) {
      conditions.push(eq(products.imageId, filter.imageId));
    }
    if (filter?.shortId) {
      conditions.push(eq(products.shortId, filter.shortId));
    }

    const productsQuery = db.query.products.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      limit: page,
      offset: offset,
      with: {
        business: options?.include?.business ? true : undefined,
        userViaProviderId: options?.include?.userViaProviderId ? true : undefined,
        orderItems: options?.include?.orderItems
          ? {
              limit: typeof options.include.orderItems === 'boolean' ? undefined : options.include.orderItems.limit,
              // offset is not directly supported in nested 'with' like this for eager loading
              with: {
                order: typeof options.include.orderItems === 'object' && options.include.orderItems.include?.order ? true : undefined,
              },
            }
          : undefined,
      },
      orderBy: [desc(products.createdAt)] // Default order
    });

    const totalQuery = db.select({ value: count() }).from(products).where(conditions.length > 0 ? and(...conditions) : undefined);

    const [data, totalResult] = await Promise.all([productsQuery, totalQuery]);
    
    return { data, total: totalResult[0]?.value ?? 0 };
  }

  async updateProduct(productId: string, data: UpdateProductData): Promise<Product | null> {
    // businessId is not part of UpdateProductData and should not be updated here.
    // providerUserId can be updated if present in data.
    const [updatedProduct] = await db
      .update(products)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(products.productId, productId))
      .returning();
    return updatedProduct || null;
  }

  async updateManyProducts(filter: ProductFilterOptions, data: UpdateManyProductsData): Promise<{ count: number }> {
    if (!filter.ids || filter.ids.length === 0) {
      // Consider other filters if applicable for bulk update
      return { count: 0 };
    }
    const result = await db
      .update(products)
      .set({ ...data, updatedAt: new Date() })
      .where(inArray(products.productId, filter.ids as string[]));
      
    return { count: result.rowCount ?? 0 }; // rowCount is specific to pg driver, may need adjustment for Neon HTTP
  }

  async deleteProduct(productId: string): Promise<boolean> {
    const result = await db.delete(products).where(eq(products.productId, productId));
    return (result.rowCount ?? 0) > 0; // rowCount is specific to pg driver, may need adjustment for Neon HTTP
  }

  async deleteManyProducts(filter: ProductFilterOptions): Promise<{ count: number }> {
    if (!filter.ids || filter.ids.length === 0) {
      return { count: 0 };
    }
    const result = await db.delete(products).where(inArray(products.productId, filter.ids as string[]));
    return { count: result.rowCount ?? 0 }; // rowCount is specific to pg driver, may need adjustment for Neon HTTP
  }

  async getProductByKeyword(keyword: string, options?: GetAllProductsOptions): Promise<{ data: ProductWithIncludes[]; total: number }> {
    const page = options?.limit ?? 10;
    const offset = options?.offset ?? 0;

    const filter: ProductFilterOptions | undefined = options?.filter;
    const conditions = [];

    // Keyword search condition
    if (keyword && keyword.trim() !== '') {
      conditions.push(or(ilike(products.name, `%${keyword}%`), ilike(products.description, `%${keyword}%`)));
    }

    // Additional filters from options
    if (filter?.name) { // This could be an additional filter if needed, or could be part of keyword logic
      conditions.push(ilike(products.name, `%${filter.name}%`));
    }
    if (filter?.businessId) {
      conditions.push(eq(products.businessId, filter.businessId));
    }
    if (filter?.providerUserId) {
      conditions.push(eq(products.providerUserId, filter.providerUserId));
    }
    if (filter?.isAvailable !== undefined) {
      conditions.push(eq(products.isAvailable, filter.isAvailable));
    }
    if (filter?.currency) {
      conditions.push(eq(products.currency, filter.currency));
    }
    if (filter?.minPrice !== undefined) {
      conditions.push(gte(products.price, filter.minPrice.toString()));
    }
    if (filter?.maxPrice !== undefined) {
      conditions.push(lte(products.price, filter.maxPrice.toString()));
    }
    if (filter?.createdAtBefore) {
      conditions.push(lte(products.createdAt, filter.createdAtBefore));
    }
    if (filter?.createdAtAfter) {
      conditions.push(gte(products.createdAt, filter.createdAtAfter));
    }
    if (filter?.imageId) {
      conditions.push(eq(products.imageId, filter.imageId));
    }
    if (filter?.shortId) {
      conditions.push(eq(products.shortId, filter.shortId));
    }

    const productsQuery = db.query.products.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      limit: page,
      offset: offset,
      with: {
        business: options?.include?.business ? true : undefined,
        userViaProviderId: options?.include?.userViaProviderId ? true : undefined,
        orderItems: options?.include?.orderItems
          ? {
              limit: typeof options.include.orderItems === 'boolean' ? undefined : options.include.orderItems.limit,
              with: {
                order: typeof options.include.orderItems === 'object' && options.include.orderItems.include?.order ? true : undefined,
              },
            }
          : undefined,
      },
      orderBy: [desc(products.createdAt)] // Default order
    });

    const totalQuery = db.select({ value: count() }).from(products).where(conditions.length > 0 ? and(...conditions) : undefined);

    const [data, totalResult] = await Promise.all([productsQuery, totalQuery]);
    
    return { data, total: totalResult[0]?.value ?? 0 };
  }
}

export const productsService = new ProductsService();
