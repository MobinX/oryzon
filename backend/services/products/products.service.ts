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
import { GoogleGenAI } from "@google/genai";
import { DataAPIClient, DataAPIVector, vector } from "@datastax/astra-db-ts";


const client = new DataAPIClient(process.env.ASTRA_TOKEN);
const database = client.db('https://bdadc1d5-436e-41bf-a36e-6fe4a1235b6b-us-east-2.apps.astra.datastax.com', { keyspace: "default_keyspace" });
const imageCollection = database.collection("image_embedding_store");
const textCollection = database.collection("text_embedding_store");



export class ProductsService {
  constructor() { }


  async generateImageEmbedding(imageUrl: string | string[], query: boolean = false): Promise<number[] | null> {
    try {
      const queryObj: {
        model: string;
        input: { image: string }[] | { image: string };
        normalized: boolean;
        task?: string;
      } = {
        model: 'jina-clip-v2',
        input: query
          ? { image: Array.isArray(imageUrl) ? imageUrl[0] : imageUrl }
          : Array.isArray(imageUrl)
            ? imageUrl.map(url => ({ image: url }))
            : [{ image: imageUrl }],
        normalized: true, // Optional, defaults to true
      }
      if (query) queryObj.task = "retrieval.query";
      const response = await fetch('https://api.jina.ai/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.JINA_API_KEY}`
        },
        body: JSON.stringify(queryObj),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return (Array.isArray(imageUrl) ? data.data.map((item: { embedding: number[] }) => item.embedding) : data.data[0]?.embedding) || null
    } catch (error) {
      console.error('Error generating image embedding:', error);
      return null;
    }
    // Return null or a string representing the embedding
  }

  l2Normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (norm === 0) return vector.map(() => 0);
    return vector.map(val => val / norm);
  }

  checkL2Norm(vector: number[]): boolean {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return norm >= 0.999 && norm <= 1.001; // Check if norm is close to 1
  }

  async generateTextEmbedding(text: string | string[], query: boolean = false): Promise<number[] | number[][] | null> {
    try {

      const ai = new GoogleGenAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY
      });

      const response = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: Array.isArray(text) ? text : [text],
        config: {
          taskType: query ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
          outputDimensionality: 512

        }
      });

      // console.log(response.embeddings[0]);
      return (Array.isArray(text) ? response?.embeddings?.map(embedding => embedding.values ? this.l2Normalize(embedding.values) : undefined).filter((values): values is number[] => values !== undefined) : response?.embeddings?.[0].values ? this.l2Normalize(response.embeddings[0].values) : null) || null;
    } catch (error) {
      console.error('Error generating text embedding:', error);
      return null;
    }
  }

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
    const imageEmbedding = await this.generateImageEmbedding(data.imageUrl!);
    const textEmbedding = await this.generateTextEmbedding(data.name + " " + data.description);

    if (!imageEmbedding) { throw new Error("Failed to generate image embedding"); }
    if (!textEmbedding) { throw new Error("Failed to generate text embedding"); }
    const [newProduct] = await db.insert(products).values(newProductData).returning();

    const imageResult = await imageCollection.insertOne({
      _id: newProduct.productId,
      $vector: imageEmbedding ? new DataAPIVector(imageEmbedding) : null,
    });
    console.log(imageResult);

    const textResult = await textCollection.insertOne({
      _id: newProduct.productId,
      $vector: textEmbedding ? new DataAPIVector(textEmbedding as number[]) : null,
    });
    console.log(textResult);

    return newProduct;
  }

  async getProductById(productId: string, options?: GetProductByIdOptions): Promise<ProductWithIncludes | null> {
    //  console.log("heheh")
    // await this.getProductsByImageURL("https://media.cnn.com/api/v1/images/stellar/prod/gettyimages-142832910.jpg", "69caedb1-aa66-4d74-95aa-de5a761d64d8");

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

   
    if(filter?.id) { // Filter by productId
      conditions.push(eq(products.productId, filter.id));
    }


    if(filter?.ids && filter.ids.length > 0) { // Filter by multiple productIds
      conditions.push(inArray(products.productId, filter.ids as string[]));
    } 
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
    const existingProduct = await db.query.products.findFirst({
      where: eq(products.productId, productId)
    });

    if (!existingProduct) {
      throw new Error("Product not found");
    }

    if (data.imageUrl && data.imageUrl !== existingProduct.imageUrl) {
      const imageEmbedding = await this.generateImageEmbedding(data.imageUrl, false);
      if (!imageEmbedding) {
        throw new Error("Failed to generate image embedding");
      }

      const result = await imageCollection.replaceOne({
        _id: productId
      }, {
        $vector: imageEmbedding ? new DataAPIVector(imageEmbedding as number[]) : null
      });
      console.log(result);
    }

    if ((data.name && data.name !== existingProduct.name) || (data.description && data.description !== existingProduct.description)) {

      const textEmbedding = await this.generateTextEmbedding((data.name || existingProduct.name) + ' ' + (data.description || existingProduct.description), false);
      //TODO: Handle text embedding storage if needed
      if (!textEmbedding) {
        throw new Error("Failed to generate text embedding");
      }

      const result = await textCollection.replaceOne({
        _id: productId
      }, {
        $vector: textEmbedding ? new DataAPIVector(textEmbedding as number[]) : null,
        text: (data.name) + ' ' + (data.description)
      });
      console.log(result);
    }
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
    const keywordConditions = [];

    // Create keyword conditions - each keyword part can match name OR description
    const keywordParts = keyword ? keyword.split(' ').filter(part => part.trim() !== '') : [];
    for (const part of keywordParts) {
      keywordConditions.push(or(ilike(products.name, `%${part}%`), ilike(products.description, `%${part}%`)));
    }

    // If we have keyword conditions, combine them with OR (any keyword can match)
    if (keywordConditions.length > 0) {
      conditions.push(or(...keywordConditions));
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


    // const textEmbedding = await this.generateTextEmbedding(keyword, true);

    // if (!textEmbedding) {
    //   throw new Error("Failed to generate text embedding");
    // }
    // console.log(textEmbedding.length)


    // // Find rows
    // const cursor = textCollection.find({}, { sort: { $vector: textEmbedding as number[] }, includeSimilarity: true });

    // // Iterate over the found documents
    // for await (const document of cursor) {
    //   console.log(document);
    // }

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


  async getProductsByImageURL(imageURL: string,businessId: string): Promise<ProductWithIncludes[]| null> {
    const productIds: string[] = [];
    const similarities: number[] = [];
    const imageEmbedding = await this.generateImageEmbedding(imageURL, true);

    if (!imageEmbedding) {
      throw new Error("Failed to generate image embedding");
    }
    console.log(imageEmbedding.length)


    // Find rows
    const cursor = imageCollection.find({}, { sort: { $vector: imageEmbedding as number[] }, includeSimilarity: true });

    // Iterate over the found documents
    for await (const document of cursor) {
       if (document && document.$similarity &&  document.$similarity >= .85) {
         productIds.push(document._id as string);
         similarities.push(document.$similarity);
       }
    }
    if (productIds.length === 0) {
      return null;
    }
    const productsWithSimilarities: ProductWithIncludes[] = [];
    const products = await this.getAllProducts(
      {
        filter: {
          ids: productIds,
          businessId: businessId
        }
      }
    );
    if (products.data.length > 0) {
      for (let i = 0; i < products.data.length; i++) {
        productsWithSimilarities.push({
          ...products.data[i],
          similarity: productIds.indexOf(products.data[i].productId) > -1 ? similarities[productIds.indexOf(products.data[i].productId)] : null
        });
      }
    }
    productsWithSimilarities.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
    console.log(productsWithSimilarities);
    return productsWithSimilarities.length > 0 ? productsWithSimilarities : null;

  }

}

export const productsService = new ProductsService();




/*
in getProductByKeyword(keyword......) the keyword is string containing different word saparated by space . i want the the function to find any product even at least any of the word matches . like "beauty product" now if any product name or having beauty or "product" or both "beauty product"  match . it also should math several products. r8 now if  beauty matvhes but "product" dont match doesnot give any result i dont like it . improve it */
