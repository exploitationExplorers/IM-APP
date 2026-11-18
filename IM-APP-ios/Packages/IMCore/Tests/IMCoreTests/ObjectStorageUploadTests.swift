import XCTest
@testable import IMCore

final class ObjectStorageUploadTests: XCTestCase {
    func testMultipartPreservesOriginalBytesAndFormSignature() throws {
        let bytes = Data([0, 255, 13, 10, 128])
        let value = try ObjectStorageUpload.encode(url: URL(string: "https://storage.example/upload?signature=unchanged")!, data: bytes, contentType: "image/gif", fields: ["key": "a/b.gif", "policy": "signed+value="], boundary: "test-boundary")
        XCTAssertEqual(value.request.httpMethod, "POST")
        XCTAssertEqual(value.request.url?.query, "signature=unchanged")
        XCTAssertEqual(value.request.value(forHTTPHeaderField: "Content-Type"), "multipart/form-data; boundary=test-boundary")
        XCTAssertNil(value.request.httpBody)
        let prefix = Data("--test-boundary\r\nContent-Disposition: form-data; name=\"key\"\r\n\r\na/b.gif\r\n--test-boundary\r\nContent-Disposition: form-data; name=\"policy\"\r\n\r\nsigned+value=\r\n--test-boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"upload\"\r\nContent-Type: image/gif\r\n\r\n".utf8)
        XCTAssertEqual(value.body, prefix + bytes + Data("\r\n--test-boundary--\r\n".utf8))
    }

    func testPutPreservesBodyAndOmitsBusinessAuthorization() throws {
        let data = Data([1, 2, 3])
        let value = try ObjectStorageUpload.encode(url: URL(string: "https://storage.example/image")!, data: data, contentType: "image/png", fields: nil, headers: ["Authorization": "business-secret", "X-Upload-Token": "storage-token"])
        XCTAssertEqual(value.request.httpMethod, "PUT")
        XCTAssertEqual(value.body, data)
        XCTAssertNil(value.request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(value.request.value(forHTTPHeaderField: "X-Upload-Token"), "storage-token")
    }

    func testRejectsInsecureURLsAndMultipartHeaderInjection() {
        for raw in ["http://storage.example/image", "https://user:password@storage.example/image"] {
            XCTAssertThrowsError(try ObjectStorageUpload.encode(url: URL(string: raw)!, data: Data(), contentType: "image/png", fields: nil))
        }
        for key in ["bad\"key", "bad\rkey", "bad\nkey"] {
            XCTAssertThrowsError(try ObjectStorageUpload.encode(url: URL(string: "https://storage.example/image")!, data: Data(), contentType: "image/png", fields: [key: "value"]))
        }
        XCTAssertThrowsError(try ObjectStorageUpload.encode(url: URL(string: "https://storage.example/image")!, data: Data(), contentType: "image/png\r\nAuthorization: injected", fields: nil))
    }
}
