//! HREF resolution — port of `src/formats/href.ts`.
//!
//! `base` is a directory (not a file path). POSIX join + normalize.

pub fn resolve_href(base: &str, href: &str) -> String {
    if href.starts_with('#') {
        return href.to_owned();
    }
    let joined = if base.is_empty() {
        href.to_owned()
    } else {
        format!("{base}/{href}")
    };
    normalize_path(&joined)
}

fn normalize_path(p: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for seg in p.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchor_preserved() {
        assert_eq!(resolve_href("a", "#ch1"), "#ch1");
    }

    #[test]
    fn relative_resolved() {
        assert_eq!(resolve_href("dir", "img.png"), "dir/img.png");
    }

    #[test]
    fn parent_dir() {
        // base is a directory; "../img.png" from "dir/sub" goes up to "dir/img.png"
        assert_eq!(resolve_href("dir/sub", "../../img.png"), "img.png");
    }

    #[test]
    fn empty_base() {
        assert_eq!(resolve_href("", "img.png"), "img.png");
    }

    #[test]
    fn nested_dir() {
        assert_eq!(resolve_href("OEBPS", "images/cover.jpg"), "OEBPS/images/cover.jpg");
    }
}