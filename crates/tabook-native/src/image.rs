//! Image decoding + PNG re-encoding for the kitty-family graphics protocol.
//!
//! The kitty graphics protocol only guarantees RGB (f=24), RGBA (f=32) and
//! PNG (f=100) payloads on the wire (JPEG is rejected — verified empirically).
//! Book images come as PNG/JPEG/GIF/WebP/BMP, so anything that is not already
//! PNG is decoded and re-encoded as PNG before transmission. The decoded
//! dimensions are returned as well, so the TUI can preserve the aspect ratio
//! when sizing the placement box.

/// Result of decoding an image and re-encoding it as PNG.
pub struct ImageToPngData {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub fn image_to_png_inner(data: &[u8]) -> Result<ImageToPngData, String> {
    let img = image::load_from_memory(data).map_err(|e| format!("cannot decode image: {e}"))?;
    let width = img.width();
    let height = img.height();
    let mut png: Vec<u8> = Vec::new();
    {
        let mut cursor = std::io::Cursor::new(&mut png);
        img.write_to(&mut cursor, image::ImageFormat::Png)
            .map_err(|e| format!("cannot encode PNG: {e}"))?;
    }
    Ok(ImageToPngData { data: png, width, height })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode(img: image::DynamicImage, format: image::ImageFormat) -> Vec<u8> {
        let mut buf: Vec<u8> = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut buf);
        img.write_to(&mut cursor, format).expect("encode");
        buf
    }

    #[test]
    fn png_round_trip() {
        let img =
            image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(2, 3, image::Rgba([255, 0, 0, 255])));
        let png = encode(img, image::ImageFormat::Png);
        let out = image_to_png_inner(&png).expect("png decode");
        assert_eq!((out.width, out.height), (2, 3));
        // Re-encoded output must still be a PNG (magic bytes).
        assert_eq!(&out.data[..8], &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }

    #[test]
    fn jpeg_is_converted_to_png() {
        let img =
            image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(4, 2, image::Rgb([10, 200, 30])));
        let jpeg = encode(img, image::ImageFormat::Jpeg);
        assert_ne!(&jpeg[..3], &[0x89, 0x50, 0x4e]);
        let out = image_to_png_inner(&jpeg).expect("jpeg decode");
        assert_eq!((out.width, out.height), (4, 2));
        assert_eq!(&out.data[..8], &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }

    #[test]
    fn garbage_is_rejected() {
        assert!(image_to_png_inner(b"not an image at all").is_err());
    }
}
