import { Request, Response } from 'express';
import { getCollection, getNextPrefixedId } from '../mongo.js';

const DEFAULT_BLOG_STATUS = 'Hiển thị';
const DEFAULT_STAFF_ID = 'NV001';

const getBlogCollection = () => getCollection('BAI_VIET');

const enrichBlog = async (blog: any) => {
  if (!blog) {
    return blog;
  }

  const employeeCollection = await getCollection('NHAN_VIEN');
  const employee = blog.NHAN_VIEN_ID
    ? await employeeCollection.findOne({ NHAN_VIEN_ID: blog.NHAN_VIEN_ID })
    : null;

  return {
    ...blog,
    TEN_NHAN_VIEN: employee?.HO_TEN || null,
    EMAIL_NHAN_VIEN: employee?.EMAIL || null,
  };
};

const resolveStaffId = async (staffId: unknown, author: unknown, email?: unknown): Promise<string> => {
  const employeeCollection = await getCollection('NHAN_VIEN');
  const normalizedStaffId = String(staffId || '').trim();

  if (normalizedStaffId) {
    return normalizedStaffId;
  }

  const normalizedEmail = String(email || '').trim();
  if (normalizedEmail) {
    const employee = await employeeCollection.findOne(
      { EMAIL: normalizedEmail },
      { sort: { NHAN_VIEN_ID: 1 }, projection: { NHAN_VIEN_ID: 1 } },
    );

    if (employee?.NHAN_VIEN_ID) {
      return employee.NHAN_VIEN_ID;
    }
  }

  const authorName = String(author || '').trim();
  if (authorName) {
    const employee = await employeeCollection.findOne(
      { HO_TEN: authorName },
      { sort: { NHAN_VIEN_ID: 1 }, projection: { NHAN_VIEN_ID: 1 } },
    );

    if (employee?.NHAN_VIEN_ID) {
      return employee.NHAN_VIEN_ID;
    }
  }

  const fallback = await employeeCollection.findOne(
    {},
    { sort: { NHAN_VIEN_ID: 1 }, projection: { NHAN_VIEN_ID: 1 } },
  );

  return fallback?.NHAN_VIEN_ID || DEFAULT_STAFF_ID;
};

export const getAllBlogs = async (_req: Request, res: Response) => {
  try {
    const collection = await getBlogCollection();
    const blogs = await collection.find({}).sort({ NGAY_DANG: -1, BAI_VIET_ID: -1 }).toArray();
    const enriched = await Promise.all(blogs.map(enrichBlog));

    return res.status(200).json(enriched);
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load blogs: ' + error.message });
  }
};

export const getBlogById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const collection = await getBlogCollection();
    const blog = await collection.findOne({ BAI_VIET_ID: id });

    if (!blog) {
      return res.status(404).json({ message: 'Không tìm thấy bài viết.' });
    }

    return res.status(200).json(await enrichBlog(blog));
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load blog: ' + error.message });
  }
};

export const createBlog = async (req: Request, res: Response) => {
  try {
    const { title, content, coverImage, category, status, staffId, author, email } = req.body;

    if (!String(title || '').trim() || !String(content || '').trim() || !String(category || '').trim()) {
      return res.status(400).json({ message: 'Thiếu tiêu đề, nội dung hoặc danh mục bài viết.' });
    }

    const collection = await getBlogCollection();
    const blogId = await getNextPrefixedId('BAI_VIET', 'BAI_VIET_ID', 'BV', 3);
    const resolvedStaffId = await resolveStaffId(staffId, author, email);
    const blog = {
      BAI_VIET_ID: blogId,
      NHAN_VIEN_ID: resolvedStaffId,
      TIEU_DE: String(title).trim(),
      NOI_DUNG: String(content || '').trim(),
      ANH_BIA: String(coverImage || '').trim() || null,
      DANH_MUC_BLOG: String(category).trim(),
      NGAY_DANG: new Date(),
      TRANG_THAI: String(status || DEFAULT_BLOG_STATUS).trim(),
      LUOT_XEM: 0,
    };

    await collection.insertOne(blog);

    return res.status(201).json({
      message: 'Blog created.',
      blog: await enrichBlog(blog),
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot create blog: ' + error.message });
  }
};

export const updateBlog = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, content, coverImage, category, status, staffId, author, email } = req.body;

    if (!id || !String(title || '').trim() || !String(content || '').trim() || !String(category || '').trim()) {
      return res.status(400).json({ message: 'Thiếu thông tin bài viết.' });
    }

    const collection = await getBlogCollection();
    const resolvedStaffId = await resolveStaffId(staffId, author, email);
    const result = await collection.findOneAndUpdate(
      { BAI_VIET_ID: id },
      {
        $set: {
          NHAN_VIEN_ID: resolvedStaffId,
          TIEU_DE: String(title).trim(),
          NOI_DUNG: String(content || '').trim(),
          ANH_BIA: String(coverImage || '').trim() || null,
          DANH_MUC_BLOG: String(category).trim(),
          TRANG_THAI: String(status || DEFAULT_BLOG_STATUS).trim(),
        },
      },
      { returnDocument: 'after' },
    );

    if (!result) {
      return res.status(404).json({ message: 'Không tìm thấy bài viết.' });
    }

    return res.status(200).json({
      message: 'Blog updated.',
      blog: await enrichBlog(result),
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot update blog: ' + error.message });
  }
};

export const deleteBlog = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: 'Missing blog id.' });
    }

    const collection = await getBlogCollection();
    const result = await collection.deleteOne({ BAI_VIET_ID: id });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Không tìm thấy bài viết.' });
    }

    return res.status(200).json({ message: 'Blog deleted.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete blog: ' + error.message });
  }
};
